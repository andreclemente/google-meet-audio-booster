(() => {
  if (window.__meetAudioBoosterInstalled) return

  window.__meetAudioBoosterInstalled = true

  const STORAGE_KEY = '__meet_audio_booster_settings_v2'

  const state = {
    gains: [],
    settings: loadSettings(),
    panel: null,
    renderTimer: null
  }

  window.__meetAudioBooster = state

  function loadSettings() {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
          gains: {},
          position: null
        }
      )
    } catch {
      return { gains: {}, position: null }
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings))
  }

  function getRemoteNames() {
    return [
      ...new Set(
        [...document.querySelectorAll('button[aria-label^="Mute "]')]
          .map((btn) => btn.getAttribute('aria-label'))
          .map((label) => label?.match(/^Mute (.+)'s microphone$/)?.[1])
          .filter(Boolean)
      )
    ]
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
    const names = getRemoteNames()

    state.gains.forEach((item, index) => {
      if (!item.name && names[index]) {
        item.name = names[index]

        const saved = state.settings.gains?.[item.name]

        if (typeof saved === 'number') {
          applyGain(item, saved)
        }
      }
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

    const visibleGains = state.gains.filter((item) => item.name)

    const list = document.createElement('div')

    Object.assign(list.style, {
      maxHeight: '260px',
      overflowY: 'auto',
      paddingRight: '4px'
    })

    if (!visibleGains.length) {
      const empty = document.createElement('div')
      empty.textContent = 'Waiting for remote audio...'
      empty.style.opacity = '0.75'
      list.appendChild(empty)
    }

    visibleGains.forEach((item) => {
      const row = document.createElement('div')

      Object.assign(row.style, {
        padding: '7px 0',
        borderTop: '1px solid #3c4043'
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
      name.textContent = item.name
      name.style.fontWeight = '600'
      name.style.overflow = 'hidden'
      name.style.textOverflow = 'ellipsis'
      name.style.whiteSpace = 'nowrap'

      const value = document.createElement('div')
      value.textContent = `${Math.round(item.value * 100)}%`
      value.style.opacity = '0.8'
      value.style.minWidth = '46px'
      value.style.textAlign = 'right'

      top.appendChild(name)
      top.appendChild(value)

      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = '0'
      slider.max = '6'
      slider.step = '0.05'
      slider.value = item.value

      Object.assign(slider.style, {
        width: '100%'
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
        marginTop: '5px',
        flexWrap: 'wrap'
      })

      buttons.appendChild(
        makeButton('Mute', () => {
          slider.value = '0'
          applyGain(item, 0)
          value.textContent = '0%'
        })
      )

      buttons.appendChild(
        makeButton('50%', () => {
          slider.value = '0.5'
          applyGain(item, 0.5)
          value.textContent = '50%'
        })
      )

      buttons.appendChild(
        makeButton('100%', () => {
          slider.value = '1'
          applyGain(item, 1)
          value.textContent = '100%'
        })
      )

      buttons.appendChild(
        makeButton('250%', () => {
          slider.value = '2.5'
          applyGain(item, 2.5)
          value.textContent = '250%'
        })
      )

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
      marginTop: '8px'
    })

    footer.appendChild(makeButton('Refresh', renderPanel))

    footer.appendChild(
      makeButton('Reset', () => {
        visibleGains.forEach((item) => applyGain(item, 1))
        renderPanel()
      })
    )

    panel.appendChild(footer)

    document.documentElement.appendChild(panel)
    state.panel = panel
  }

  function makeButton(text, onClick) {
    const btn = document.createElement('button')
    btn.textContent = text
    Object.assign(btn.style, buttonStyle())
    btn.onclick = onClick
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
    setInterval(renderPanel, 5000)
  }

  boot()
})()
