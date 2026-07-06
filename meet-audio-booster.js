(() => {
  if (window.__meetAudioBoosterInstalled) return

  window.__meetAudioBoosterInstalled = true

  const STORAGE_KEY = '__meet_audio_booster_settings_v11'

  const state = {
    gains: [],
    settings: loadSettings(),
    participants: new Set(),
    panel: null,
    renderTimer: null,
    listScrollTop: 0,
    status: '',
    loadingParticipants: false
  }

  window.__meetAudioBooster = state

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
        gains: {},
        position: null,
        participants: [],
        hiddenParticipants: []
      }
    } catch {
      return { gains: {}, position: null, participants: [], hiddenParticipants: [] }
    }
  }

  function saveSettings() {
    state.settings.participants = [...state.participants]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings))
  }

  ;(state.settings.participants || []).forEach((name) => {
    state.participants.add(name)
  })

  function hiddenParticipants() {
    state.settings.hiddenParticipants ||= []
    return state.settings.hiddenParticipants
  }

  function isHiddenParticipant(name) {
    return hiddenParticipants().some((hidden) => hidden.toLowerCase() === name.toLowerCase())
  }

  function hideParticipant(name) {
    if (!isHiddenParticipant(name)) hiddenParticipants().push(name)
    state.participants.delete(name)
    saveSettings()
    setStatus(`Hidden ${name}`)
    renderPanel()
  }

  function setStatus(message) {
    state.status = message
    const status = document.getElementById('__meet_audio_booster_status')
    if (status) status.textContent = message
  }

  function cleanName(name) {
    return name
      ?.replace(/\s+\(.*?\)$/, '')
      .replace(/^Mute\s+(.+?)'s microphone$/i, '$1')
      .replace(/^Unmute\s+(.+?)'s microphone$/i, '$1')
      .replace(/^Ask\s+(.+?)\s+to unmute$/i, '$1')
      .replace(/^Mute\s+/i, '')
      .replace(/^Unmute\s+/i, '')
      .replace(/'s microphone$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function isGenericAudioName(name) {
    return /^Audio \d+$/i.test(name || '')
  }

  function isValidParticipantName(name) {
    if (!name) return false

    const lower = name.toLowerCase()
    const ignored = [
      'people',
      'chat',
      'meeting details',
      'audio settings',
      'video settings',
      'more options',
      'host controls',
      'meeting tools',
      'send a reaction',
      'raise hand',
      'leave call',
      'present now',
      'activities',
      'captions',
      'visual effects',
      'settings',
      'close',
      'search for people',
      'add people',
      'in call',
      'contributors',
      'meeting host',
      'host',
      'co-host',
      'you',
      'me'
    ]

    return (
      name.length >= 2 &&
      name.length <= 80 &&
      !ignored.includes(lower) &&
      !lower.includes('(you)') &&
      !lower.includes('presentation') &&
      !lower.includes('microphone') &&
      !lower.includes('camera') &&
      !lower.includes('screen') &&
      !lower.includes('muted') &&
      !lower.includes('speaking') &&
      !lower.includes('participant') &&
      !lower.includes('meeting') &&
      !lower.includes('google meet') &&
      !/^\d+$/.test(name)
    )
  }

  function isSelfParticipantText(text) {
    return /(^|[\s(])you([\s)]|$)/i.test(text || '')
  }

  function isSelfParticipantElement(el) {
    const row = el?.closest?.('[data-participant-id], [role="listitem"], [role="gridcell"]') || el
    const text = row?.textContent || ''
    if (isSelfParticipantText(text)) return true

    return [...(row?.querySelectorAll?.('[aria-label]') || [])].some((node) => {
      const label = node.getAttribute('aria-label') || ''
      return /^your\b/i.test(label) || /\byou are\b/i.test(label) || /\byou\s+\(/i.test(label) ||
        /^(mute|unmute|turn (on|off)) your (microphone|camera)$/i.test(label)
    })
  }

  function rememberSelfParticipantFromElement(el) {
    const row = el?.closest?.('[data-participant-id], [role="listitem"], [role="gridcell"]') || el
    const candidate = (row?.textContent || '')
      .split('\n')
      .map(cleanName)
      .find(isValidParticipantName)

    if (candidate && !isHiddenParticipant(candidate)) hiddenParticipants().push(candidate)
    if (candidate) state.participants.delete(candidate)
  }

  function addParticipantName(names, rawName) {
    if (isSelfParticipantText(rawName)) return

    const name = cleanName(rawName)
    if (!isValidParticipantName(name) || isHiddenParticipant(name)) return

    const canonical = name.toLowerCase()
    const duplicate = [...names].some((existing) => existing.toLowerCase() === canonical)
    if (!duplicate) names.add(name)
  }

  function scrapeNamesFromRoot(root, names) {
    root.querySelectorAll?.('[aria-label], [data-participant-id], [role="listitem"], [role="gridcell"]').forEach((el) => {
      const label = el.getAttribute?.('aria-label') || ''
      const row = el.closest?.('[data-participant-id], [role="listitem"], [role="gridcell"]')
      const rowText = row?.textContent || ''

      // Google Meet marks your own People-panel row with "(You)" or local controls like "your microphone".
      if (isSelfParticipantText(rowText) || isSelfParticipantElement(el)) {
        rememberSelfParticipantFromElement(el)
        return
      }

      const matches = [
        label.match(/^Mute (.+)'s microphone$/i),
        label.match(/^Unmute (.+)'s microphone$/i),
        label.match(/^Ask (.+) to unmute$/i),
        label.match(/^More (?:actions|options) for (.+)$/i),
        label.match(/^Pin (.+?)(?: to your main screen)?$/i),
        label.match(/^Unpin (.+?)(?: from your main screen)?$/i),
        label.match(/^Remove (.+) from (?:the )?call$/i),
        label.match(/^(.+),\s*(?:muted|not muted|speaking)$/i),
        label.match(/^(.+)'s (?:microphone|camera)$/i)
      ]

      matches.forEach((match) => addParticipantName(names, match?.[1]))

      if (el.matches?.('[data-participant-id], [role="listitem"], [role="gridcell"]')) {
        const lines = (el.textContent || '')
          .split('\n')
          .map(cleanName)
          .filter(Boolean)

        // People-panel rows usually put the participant name in the first useful text line.
        const firstName = lines.find(isValidParticipantName)
        addParticipantName(names, firstName)
      }
    })
  }

  function scrapeParticipantNames(root = document) {
    const names = new Set()
    state.participants.forEach((name) => addParticipantName(names, name))
    scrapeNamesFromRoot(root, names)

    state.participants = names
    saveSettings()

    return [...names]
  }

  function findPeopleButton() {
    return [...document.querySelectorAll('button[aria-label], div[role="button"][aria-label]')].find((btn) => {
      const label = btn.getAttribute('aria-label') || ''
      return (
        label === 'People' ||
        label.startsWith('People') ||
        label.includes('Show everyone') ||
        label.toLowerCase().includes('participants')
      )
    })
  }

  function getScrollableContainers() {
    return [...document.querySelectorAll('div, section, aside')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return (
          rect.width >= 180 &&
          rect.height >= 120 &&
          el.scrollHeight > el.clientHeight + 40 &&
          getComputedStyle(el).overflowY !== 'hidden'
        )
      })
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function loadAllParticipants() {
    state.loadingParticipants = true
    setStatus('Loading participants...')
    renderPanel()

    try {
      const peopleButton = findPeopleButton()
      peopleButton?.click()

      await wait(700)
      scrapeParticipantNames()

      const containers = getScrollableContainers()

      for (const container of containers) {
        const originalTop = container.scrollTop
        const maxTop = container.scrollHeight - container.clientHeight
        const step = Math.max(80, Math.floor(container.clientHeight * 0.8))

        for (let top = 0; top <= maxTop + step; top += step) {
          container.scrollTop = Math.min(top, maxTop)
          await wait(90)
          scrapeParticipantNames(container)
        }

        container.scrollTop = originalTop
      }

      const names = scrapeParticipantNames()
      setStatus(`Loaded ${names.length} participants`)
    } finally {
      state.loadingParticipants = false
      renderPanel()
    }
  }

  function applyGain(item, value) {
    item.gain.gain.value = value
    item.value = value

    if (item.name) {
      state.settings.gains[item.name] = value
      saveSettings()
    }
  }

  function renderSoon() {
    clearTimeout(state.renderTimer)
    state.renderTimer = setTimeout(renderPanel, 250)
  }

  const originalConnect = AudioNode.prototype.connect

  AudioNode.prototype.connect = function (...args) {
    const from = this
    const to = args[0]

    const result = originalConnect.apply(this, args)

    if (
      from?.constructor?.name === 'AudioWorkletNode' &&
      to?.constructor?.name === 'GainNode' &&
      !state.gains.some((item) => item.gain === to)
    ) {
      const item = {
        index: state.gains.length,
        worklet: from,
        gain: to,
        originalValue: to.gain.value || 1,
        value: to.gain.value || 1,
        name: null
      }

      state.gains.push(item)
      renderSoon()
    }

    return result
  }

  function syncNames() {
    const names = scrapeParticipantNames()

    names.forEach((name, index) => {
      const existing = state.gains.find((gain) => gain.name === name)
      if (existing) return

      const item = state.gains[index]
      if (!item || item.name) return

      item.name = name

      const saved = state.settings.gains?.[name]
      if (typeof saved === 'number') applyGain(item, saved)
    })
  }

  function makeDraggable(panel, handle) {
    let dragging = false
    let startX = 0
    let startY = 0
    let startLeft = 0
    let startTop = 0

    handle.style.cursor = 'move'

    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return

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

      const nextLeft = startLeft + event.clientX - startX
      const nextTop = startTop + event.clientY - startY

      panel.style.left = `${Math.max(8, nextLeft)}px`
      panel.style.top = `${Math.max(8, nextTop)}px`
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

  function renderPanel() {
    if (!document.documentElement) return

    syncNames()

    document.getElementById('__meet_audio_booster_panel')?.remove()

    const panel = document.createElement('div')
    panel.id = '__meet_audio_booster_panel'

    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '2147483647',
      width: '280px',
      background: '#202124',
      color: '#fff',
      padding: '10px',
      borderRadius: '12px',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      boxShadow: '0 6px 22px rgba(0,0,0,.45)',
      userSelect: 'none'
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
      marginBottom: '8px'
    })

    const title = document.createElement('div')
    title.textContent = 'Meet Audio Booster'
    title.style.fontWeight = '700'
    title.style.fontSize = '13px'

    const close = document.createElement('button')
    close.textContent = '×'

    Object.assign(close.style, buttonStyle(), {
      width: '24px',
      height: '24px',
      padding: '0',
      fontSize: '16px',
      lineHeight: '16px'
    })

    close.onclick = () => panel.remove()

    header.appendChild(title)
    header.appendChild(close)
    panel.appendChild(header)

    makeDraggable(panel, header)

    const participantNames = [...state.participants].filter((name) => !isHiddenParticipant(name))
    // Render discovered remote roster rows so the panel is not capped by the number
    // of currently materialized Meet gain nodes. Gain nodes are attached by index
    // when available; rows without one stay disabled until Meet creates audio for them.
    const audioParticipantNames = participantNames.length === state.gains.length + 1
      ? participantNames.slice(1)
      : participantNames

    const rosterRows = audioParticipantNames.map((participantName, index) => {
      const item = state.gains[index] || null

      if (item && (!item.name || isGenericAudioName(item.name))) {
        item.name = participantName

        const saved = state.settings.gains?.[participantName]
        if (typeof saved === 'number') applyGain(item, saved)
      }

      return { participantName, item }
    })

    const extraGainRows = state.gains.slice(rosterRows.length).map((item, offset) => {
      const index = rosterRows.length + offset
      const participantName = item.name || `Audio ${index + 1}`
      if (!item.name) item.name = participantName
      return { participantName, item }
    })

    const visibleRows = [...rosterRows, ...extraGainRows]
      .filter(({ participantName }) => !isHiddenParticipant(participantName))

    const list = document.createElement('div')

    Object.assign(list.style, {
      maxHeight: '260px',
      overflowY: 'auto',
      paddingRight: '4px'
    })

    list.scrollTop = state.listScrollTop
    list.addEventListener('scroll', () => {
      state.listScrollTop = list.scrollTop
    })

    if (!visibleRows.length) {
      const empty = document.createElement('div')
      empty.textContent = 'Waiting for remote audio controls...'
      empty.style.opacity = '0.75'
      list.appendChild(empty)
    }

    visibleRows.forEach(({ participantName, item }) => {
      const hasAudioControl = Boolean(item)

      const row = document.createElement('div')

      Object.assign(row.style, {
        padding: '7px 0',
        borderTop: '1px solid #3c4043',
        opacity: hasAudioControl ? '1' : '0.55'
      })

      const top = document.createElement('div')

      Object.assign(top.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '5px',
        gap: '8px'
      })

      const name = document.createElement('div')
      name.textContent = participantName
      name.style.fontWeight = '600'
      name.style.overflow = 'hidden'
      name.style.textOverflow = 'ellipsis'
      name.style.whiteSpace = 'nowrap'

      const value = document.createElement('div')
      value.textContent = hasAudioControl
        ? `${Math.round(item.value * 100)}%`
        : 'inactive'
      value.style.opacity = hasAudioControl ? '0.8' : '0.5'
      value.style.minWidth = '46px'
      value.style.textAlign = 'right'

      top.appendChild(name)
      top.appendChild(value)

      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'
      slider.max = '6'
      slider.step = '0.05'
      slider.value = hasAudioControl ? item.value : '1'
      slider.disabled = !hasAudioControl

      Object.assign(slider.style, {
        width: '100%',
        opacity: hasAudioControl ? '1' : '0.4'
      })

      slider.oninput = () => {
        if (!item) return

        const next = Number(slider.value)

        applyGain(item, next)
        value.textContent = `${Math.round(next * 100)}%`
        setStatus(`${participantName}: ${Math.round(next * 100)}%`)
      }

      const buttons = document.createElement('div')

      Object.assign(buttons.style, {
        display: 'flex',
        gap: '5px',
        marginTop: '5px',
        flexWrap: 'wrap'
      })

      buttons.appendChild(makeButton('Mute', () => {
        if (!item) return
        slider.value = '0'
        applyGain(item, 0)
        value.textContent = '0%'
        setStatus(`${participantName}: muted`)
      }, !hasAudioControl))

      buttons.appendChild(makeButton('50%', () => {
        if (!item) return
        slider.value = '0.5'
        applyGain(item, 0.5)
        value.textContent = '50%'
        setStatus(`${participantName}: 50%`)
      }, !hasAudioControl))

      buttons.appendChild(makeButton('100%', () => {
        if (!item) return
        slider.value = '1'
        applyGain(item, 1)
        value.textContent = '100%'
        setStatus(`${participantName}: 100%`)
      }, !hasAudioControl))

      buttons.appendChild(makeButton('250%', () => {
        if (!item) return
        slider.value = '2.5'
        applyGain(item, 2.5)
        value.textContent = '250%'
        setStatus(`${participantName}: 250%`)
      }, !hasAudioControl))

      row.appendChild(top)
      row.appendChild(slider)
      row.appendChild(buttons)
      list.appendChild(row)
    })

    panel.appendChild(list)

    const footer = document.createElement('div')

    Object.assign(footer.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '8px',
      gap: '5px',
      flexWrap: 'wrap'
    })

    footer.appendChild(makeButton('Refresh', () => {
      setStatus('Refreshing...')
      renderPanel()
      setStatus('Refreshed')
    }))

    footer.appendChild(makeButton('Reset', () => {
      state.settings.hiddenParticipants = []

      visibleRows.forEach(({ item }) => {
        if (item) applyGain(item, 1)
      })

      saveSettings()
      renderPanel()
      setStatus('Reset gains')
    }))

    panel.appendChild(footer)

    const status = document.createElement('div')
    status.id = '__meet_audio_booster_status'
    status.textContent = state.status
    Object.assign(status.style, {
      minHeight: '14px',
      marginTop: '6px',
      color: '#bdc1c6',
      fontSize: '11px'
    })
    panel.appendChild(status)

    document.documentElement.appendChild(panel)
    list.scrollTop = state.listScrollTop
    state.panel = panel
  }

  function makeButton(text, onClick, disabled = false, busyText = null) {
    const btn = document.createElement('button')
    btn.textContent = busyText || text
    btn.disabled = disabled

    Object.assign(btn.style, buttonStyle())

    if (disabled) {
      btn.style.opacity = '0.45'
      btn.style.cursor = 'not-allowed'
    }

    btn.onclick = async () => {
      if (btn.disabled) return

      const originalText = btn.textContent
      btn.textContent = 'Working...'
      btn.disabled = true

      try {
        await onClick?.()
      } finally {
        btn.textContent = originalText
        btn.disabled = false
      }
    }

    return btn
  }

  function buttonStyle() {
    return {
      background: '#3c4043',
      color: '#fff',
      border: '1px solid #5f6368',
      borderRadius: '6px',
      padding: '4px 7px',
      cursor: 'pointer',
      fontSize: '11px'
    }
  }

  function boot() {
    if (!document.documentElement) {
      setTimeout(boot, 100)
      return
    }

    renderPanel()
    setInterval(() => {
      scrapeParticipantNames()
      if (!state.panel?.isConnected) renderPanel()
    }, 5000)
  }

  boot()
})()
