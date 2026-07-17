(() => {
  if (window.__meetingAudioBoosterInstalled) return
  window.__meetingAudioBoosterInstalled = true

  const STORAGE_KEY = '__meeting_audio_booster_v7'
  const PANEL_ID = '__meeting_audio_booster_panel'
  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  const state = {
    platform: null,
    items: [],
    settings: loadSettings(),
    panel: null,
    renderTimer: null,
    sharedCtx: null,
    closed: false,
    googleNameTimer: null,
    jitsiKeepAliveTimer: null
  }

  window.__meetingAudioBooster = state

  function loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}

      return {
        gains: settings.gains || {},
        labels: settings.labels || {},
        position: settings.position || null,
        showAllGooglePaths: Boolean(settings.showAllGooglePaths)
      }
    } catch {
      return {
        gains: {},
        labels: {},
        position: null,
        showAllGooglePaths: false
      }
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings))
  }

  function detectPlatform() {
    if (location.hostname === 'meet.google.com') return 'google-meet'

    if (
      window.APP?.conference ||
      window.JitsiMeetJS ||
      document.querySelector('#react, .filmstrip, [data-testid]')
    ) {
      return 'jitsi'
    }

    return 'jitsi'
  }

  function getSharedAudioContext() {
    if (!AudioContextClass) return null

    state.sharedCtx ||= new AudioContextClass()
    return state.sharedCtx
  }

  function cleanName(value) {
    return value
      ?.replace(/\s+\(.*?\)$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function getStorageId(item) {
    return `${item.platform}:${item.storageId}`
  }

  function getDisplayName(item) {
    return item.name || item.defaultName
  }

  function addItem(item) {
    if (state.items.some((existing) => existing.key === item.key)) return

    const storageId = getStorageId(item)
    const savedLabel = state.settings.labels?.[storageId]
    const savedGain = state.settings.gains?.[storageId]

    if (savedLabel) {
      item.name = savedLabel
      item.hasManualLabel = true
    }

    item.value = typeof savedGain === 'number' ? savedGain : item.value ?? 1
    item.setGain(item.value)

    state.items.push(item)
    renderSoon()
  }

  function applyGain(item, value) {
    item.value = value
    item.setGain(value)

    state.settings.gains ||= {}
    state.settings.gains[getStorageId(item)] = value
    saveSettings()
  }

  function renameItem(item, value) {
    const name = cleanName(value) || item.defaultName
    item.name = name
    item.hasManualLabel = true

    state.settings.labels ||= {}
    state.settings.labels[getStorageId(item)] = name
    saveSettings()

    renderSoon()
  }

  function renderSoon() {
    if (state.closed) return

    clearTimeout(state.renderTimer)
    state.renderTimer = setTimeout(renderPanel, 150)
  }

  // ---------------------------------------------------------------------------
  // Google Meet
  // ---------------------------------------------------------------------------

  function initGoogleMeet() {
    const originalConnect = AudioNode.prototype.connect

    AudioNode.prototype.connect = function (...args) {
      const from = this
      const to = args[0]

      const result = originalConnect.apply(this, args)

      if (
        from?.constructor?.name === 'AudioWorkletNode' &&
        to?.constructor?.name === 'GainNode' &&
        !state.items.some((item) => item.platform === 'google-meet' && item.gain === to)
      ) {
        const googleItems = state.items.filter((item) => item.platform === 'google-meet')
        const index = googleItems.length
        const currentValue = readAudioParam(to.gain)

        addItem({
          key: `google:${index}`,
          storageId: `path:${index}`,
          platform: 'google-meet',
          name: null,
          defaultName: `Speaker ${index + 1}`,
          gain: to,
          value: currentValue,
          setGain(value) {
            writeAudioParam(to.gain, value)
          }
        })

        scheduleGoogleMeetNameSync()
      }

      return result
    }

    scheduleGoogleMeetNameSync()
    setInterval(scheduleGoogleMeetNameSync, 5000)
  }

  function readAudioParam(param) {
    const value = Number(param?.value)

    if (Number.isFinite(value) && value >= 0) return value

    return 1
  }

  function writeAudioParam(param, value) {
    try {
      param.setValueAtTime(value, param.context.currentTime)
    } catch {}

    try {
      param.value = value
    } catch {}
  }

  function scheduleGoogleMeetNameSync() {
    clearTimeout(state.googleNameTimer)

    state.googleNameTimer = setTimeout(() => {
      syncGoogleMeetNames()
      setTimeout(syncGoogleMeetNames, 1000)
      setTimeout(syncGoogleMeetNames, 3000)
    }, 500)
  }

  function syncGoogleMeetNames() {
  state.googleNameSuggestions = getGoogleMeetRemoteNames()
  renderSoon()
}

function identifyItem(item) {
  const items = getVisibleItems()
  const previous = items.map((entry) => ({
    item: entry,
    value: entry.value
  }))

  items.forEach((entry) => {
    if (entry === item) {
      entry.setGain(2.5)
    } else {
      entry.setGain(0.15)
    }
  })

  setTimeout(() => {
    previous.forEach(({ item: entry, value }) => {
      entry.setGain(value)
    })
  }, 3500)
}

  function getGoogleMeetRemoteNames() {
    return [
      ...new Set(
        [...document.querySelectorAll('button[aria-label^="Mute "]')]
          .map((button) => button.getAttribute('aria-label'))
          .map((label) => label?.match(/^Mute (.+)'s microphone$/)?.[1])
          .map(cleanName)
          .filter(isValidGoogleMeetRemoteName)
      )
    ]
  }

  function isValidGoogleMeetRemoteName(name) {
    if (!name) return false
    if (name.length < 2) return false
    if (name.length > 70) return false
    if (name === 'You') return false
    if (name.includes('(You)')) return false
    if (name.toLowerCase().includes('presentation')) return false

    return true
  }

  function getVisibleGoogleMeetItems() {
    const googleItems = state.items.filter((item) => item.platform === 'google-meet')

    if (state.settings.showAllGooglePaths) {
      return googleItems
    }

    const namedItems = googleItems.filter((item) => item.name)

    if (namedItems.length) {
      return namedItems
    }

    return googleItems.slice(0, 1)
  }

  // ---------------------------------------------------------------------------
  // Jitsi
  // ---------------------------------------------------------------------------

  function initJitsi() {
    const OriginalRTCPeerConnection = window.RTCPeerConnection

    if (!OriginalRTCPeerConnection) return

    function WrappedRTCPeerConnection(...args) {
      const pc = new OriginalRTCPeerConnection(...args)
      let userOnTrack = null

      pc.addEventListener('track', (event) => {
        handleJitsiTrack(event)

        if (typeof userOnTrack === 'function') {
          userOnTrack.call(pc, event)
        }
      })

      Object.defineProperty(pc, 'ontrack', {
        get() {
          return userOnTrack
        },
        set(handler) {
          userOnTrack = handler
        },
        configurable: true
      })

      return pc
    }

    WrappedRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype
    Object.setPrototypeOf(WrappedRTCPeerConnection, OriginalRTCPeerConnection)

    window.RTCPeerConnection = WrappedRTCPeerConnection

    startJitsiKeepAlive()
  }

  function isJitsiRemoteAudio(track, streams) {
    if (!track || track.kind !== 'audio') return false
    if (track.id === 'remote-audio-1') return false

    const streamIds = streams?.map((stream) => stream.id) || []

    if (streamIds.includes('mixedmslabel')) return false
    if (streamIds.includes('remote-audio-1')) return false

    return streamIds.some((id) => id.includes('-audio-'))
  }

  function handleJitsiTrack(event) {
    const track = event.track

    if (!isJitsiRemoteAudio(track, event.streams)) return

    const streamKey = event.streams?.map((stream) => stream.id).join('|') || track.id
    const key = `jitsi:${streamKey}`

    if (state.items.some((item) => item.key === key)) return

    muteOriginalJitsiPlayback()

    const participantId = getJitsiParticipantId(event.streams)
    const index = state.items.filter((item) => item.platform === 'jitsi').length
    const name = getJitsiParticipantName(participantId, `Remote participant ${index + 1}`)

    const ctx = getSharedAudioContext()
    if (!ctx) return

    const clonedTrack = track.clone()
    clonedTrack.enabled = true

    const source = ctx.createMediaStreamSource(new MediaStream([clonedTrack]))
    const gain = ctx.createGain()

    source.connect(gain)
    gain.connect(ctx.destination)

    addItem({
      key,
      storageId: participantId || streamKey,
      platform: 'jitsi',
      name,
      defaultName: name,
      participantId,
      originalTrack: track,
      clonedTrack,
      source,
      gain,
      value: 1,
      setGain(value) {
        muteOriginalJitsiPlayback()

        clonedTrack.enabled = value > 0
        gain.gain.value = value

        const sharedCtx = getSharedAudioContext()
        if (sharedCtx?.state === 'suspended') {
          sharedCtx.resume?.()
        }
      }
    })
  }

  function muteOriginalJitsiPlayback() {
    document.querySelectorAll('audio').forEach((audio) => {
      if (!(audio.srcObject instanceof MediaStream)) return

      audio.muted = true
      audio.volume = 0
    })
  }

  function startJitsiKeepAlive() {
    if (state.jitsiKeepAliveTimer) return

    state.jitsiKeepAliveTimer = setInterval(() => {
      muteOriginalJitsiPlayback()

      const ctx = getSharedAudioContext()

      if (ctx?.state === 'suspended') {
        ctx.resume?.()
      }

      state.items.forEach((item) => {
        if (item.platform !== 'jitsi') return

        item.clonedTrack.enabled = item.value > 0
        item.gain.gain.value = item.value
      })
    }, 1000)
  }

  function getJitsiParticipantId(streams) {
    const streamId = streams?.map((stream) => stream.id).find((id) => id.includes('-audio-'))
    return streamId?.split('-audio-')[0] || null
  }

  function getJitsiParticipantName(participantId, fallback) {
    if (!participantId) return fallback

    try {
      const room = window.APP?.conference?._room

      const participant =
        room?.getParticipantById?.(participantId) ||
        room?.participants?.[participantId]

      const name =
        participant?.getDisplayName?.() ||
        participant?._displayName ||
        participant?.displayName ||
        participant?._identity?.user?.name

      if (name) return cleanName(name)
    } catch {}

    return fallback
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function getVisibleItems() {
    if (state.platform === 'google-meet') {
      return getVisibleGoogleMeetItems()
    }

    return state.items.filter((item) => item.platform === state.platform)
  }

  function renderPanel() {
    if (!document.documentElement || state.closed) return

    document.getElementById(PANEL_ID)?.remove()

    const visibleItems = getVisibleItems()

    const panel = document.createElement('div')
    panel.id = PANEL_ID

    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '2147483647',
      width: '300px',
      background: '#202124',
      color: '#fff',
      padding: '11px',
      borderRadius: '14px',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,.5)',
      userSelect: 'none',
      boxSizing: 'border-box'
    })

    if (state.settings.position) {
      panel.style.left = `${state.settings.position.left}px`
      panel.style.top = `${state.settings.position.top}px`
    } else {
      panel.style.right = '12px'
      panel.style.top = '72px'
    }

    const header = document.createElement('div')

    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    })

    const titleWrap = document.createElement('div')
    titleWrap.style.minWidth = '0'

    const title = document.createElement('div')
    title.textContent =
      state.platform === 'google-meet'
        ? 'Google Meet Audio Booster'
        : 'Jitsi Audio Booster'

    Object.assign(title.style, {
      fontWeight: '700',
      fontSize: '13px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    })

    const subtitle = document.createElement('div')
    subtitle.textContent = getSubtitle(visibleItems)

    Object.assign(subtitle.style, {
      opacity: '0.68',
      fontSize: '11px',
      marginTop: '2px'
    })

    titleWrap.appendChild(title)
    titleWrap.appendChild(subtitle)

    const close = makeButton('×', () => {
      state.closed = true
      panel.remove()
    })

    Object.assign(close.style, {
      width: '26px',
      height: '26px',
      padding: '0',
      fontSize: '16px',
      lineHeight: '16px',
      flex: '0 0 auto'
    })

    header.appendChild(titleWrap)
    header.appendChild(close)
    panel.appendChild(header)

    makeDraggable(panel, header)

    const list = document.createElement('div')

    Object.assign(list.style, {
      maxHeight: '300px',
      overflowY: 'auto',
      paddingRight: '4px'
    })

    if (!visibleItems.length) {
      const empty = document.createElement('div')
      empty.textContent = 'Waiting for remote audio...'

      Object.assign(empty.style, {
        opacity: '0.75',
        padding: '8px 0'
      })

      list.appendChild(empty)
    }

    visibleItems.forEach((item) => {
      list.appendChild(renderRow(item))
    })

    panel.appendChild(list)
    panel.appendChild(renderFooter(visibleItems))

    document.documentElement.appendChild(panel)
    state.panel = panel
  }

  function getSubtitle(visibleItems) {
    if (state.platform === 'google-meet') {
      const total = state.items.filter((item) => item.platform === 'google-meet').length

      if (state.settings.showAllGooglePaths) {
        return `${visibleItems.length}/${total} audio paths shown`
      }

      return total > visibleItems.length
        ? `${visibleItems.length}/${total} mapped audio paths`
        : `${visibleItems.length} audio path${visibleItems.length === 1 ? '' : 's'}`
    }

    return `${visibleItems.length} remote audio track${visibleItems.length === 1 ? '' : 's'}`
  }

  function renderRow(item) {
    const row = document.createElement('div')

    Object.assign(row.style, {
      padding: '8px 0',
      borderTop: '1px solid #3c4043'
    })

    const top = document.createElement('div')

    Object.assign(top.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 48px',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '5px'
    })

    const name = document.createElement('input')
    name.value = getDisplayName(item)
    name.title = 'Click to rename'

    Object.assign(name.style, {
      background: 'transparent',
      color: '#fff',
      border: '1px solid transparent',
      borderRadius: '6px',
      padding: '3px 4px',
      fontWeight: '600',
      fontSize: '12px',
      minWidth: '0',
      outline: 'none'
    })

    name.addEventListener('focus', () => {
      name.style.borderColor = '#5f6368'
      name.style.background = '#2b2c2f'
    })

    name.addEventListener('blur', () => {
      name.style.borderColor = 'transparent'
      name.style.background = 'transparent'
      renameItem(item, name.value)
    })

    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        name.blur()
      }
    })

    const value = document.createElement('div')
    value.textContent = `${Math.round(item.value * 100)}%`

    Object.assign(value.style, {
      opacity: '0.86',
      minWidth: '46px',
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums'
    })

    top.appendChild(name)
    top.appendChild(value)

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '6'
    slider.step = '0.05'
    slider.value = item.value

    Object.assign(slider.style, {
      width: '100%',
      margin: '0'
    })

    slider.oninput = () => {
      const next = Number(slider.value)
      applyGain(item, next)
      value.textContent = `${Math.round(next * 100)}%`
    }

    const buttons = document.createElement('div')

    Object.assign(buttons.style, {
      display: 'flex',
      gap: '5px',
      marginTop: '7px',
      flexWrap: 'wrap'
    })

    buttons.appendChild(makeButton('Mute', () => {
      slider.value = '0'
      applyGain(item, 0)
      value.textContent = '0%'
    }))

    buttons.appendChild(makeButton('50%', () => {
      slider.value = '0.5'
      applyGain(item, 0.5)
      value.textContent = '50%'
    }))

    buttons.appendChild(makeButton('100%', () => {
      slider.value = '1'
      applyGain(item, 1)
      value.textContent = '100%'
    }))

    buttons.appendChild(makeButton('250%', () => {
      slider.value = '2.5'
      applyGain(item, 2.5)
      value.textContent = '250%'
    }))

    row.appendChild(top)
    row.appendChild(slider)
    row.appendChild(buttons)

    return row
  }

  function renderFooter(visibleItems) {
    const footer = document.createElement('div')

    Object.assign(footer.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      marginTop: '9px',
      paddingTop: '8px',
      borderTop: '1px solid #3c4043'
    })

    if (state.platform === 'google-meet') {
      footer.appendChild(makeButton(
        state.settings.showAllGooglePaths ? 'Hide extra paths' : 'Show all paths',
        () => {
          state.settings.showAllGooglePaths = !state.settings.showAllGooglePaths
          saveSettings()
          renderPanel()
        }
      ))
    }

    footer.appendChild(makeButton('Refresh', () => {
      if (state.platform === 'google-meet') {
        syncGoogleMeetNames()
      }

      renderPanel()
    }))

    footer.appendChild(makeButton('Reset', () => {
      visibleItems.forEach((item) => {
        applyGain(item, 1)
      })

      renderPanel()
    }))

    return footer
  }

  function makeButton(text, onClick) {
    const btn = document.createElement('button')
    btn.textContent = text

    Object.assign(btn.style, {
      background: '#303134',
      color: '#fff',
      border: '1px solid #5f6368',
      borderRadius: '7px',
      padding: '5px 8px',
      cursor: 'pointer',
      fontSize: '11px',
      lineHeight: '14px'
    })

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#3c4043'
    })

    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#303134'
    })

    btn.onclick = onClick

    return btn
  }

  function makeDraggable(panel, handle) {
    let dragging = false
    let startX = 0
    let startY = 0
    let startLeft = 0
    let startTop = 0

    handle.style.cursor = 'move'

    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('button, input, textarea, select')) return

      dragging = true
      startX = event.clientX
      startY = event.clientY

      const rect = panel.getBoundingClientRect()
      startLeft = rect.left
      startTop = rect.top

      event.preventDefault()
    })

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return

      panel.style.left = `${Math.max(8, startLeft + event.clientX - startX)}px`
      panel.style.top = `${Math.max(8, startTop + event.clientY - startY)}px`
      panel.style.right = 'auto'
    })

    window.addEventListener('mouseup', () => {
      if (!dragging) return

      dragging = false

      const rect = panel.getBoundingClientRect()

      state.settings.position = {
        left: rect.left,
        top: rect.top
      }

      saveSettings()
    })
  }

  function boot() {
    if (!document.documentElement) {
      setTimeout(boot, 100)
      return
    }

    state.platform = detectPlatform()

    if (state.platform === 'google-meet') {
      initGoogleMeet()
    } else {
      initJitsi()
    }

    renderPanel()
  }

  boot()
})()
