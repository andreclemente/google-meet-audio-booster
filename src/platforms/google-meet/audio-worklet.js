import { readAudioParam, writeAudioParam } from '../../shared/audio.js'

export function installAudioWorkletHook(onSlot) {
  if (!globalThis.AudioNode || globalThis.__meetingAudioBoosterWorkletHook) return () => {}
  const original = AudioNode.prototype.connect
  globalThis.__meetingAudioBoosterWorkletHook = original
  const wrapper = function (...args) {
    const from = this
    const to = args[0]
    const result = original.apply(from, args)
    if (from?.constructor?.name === 'AudioWorkletNode' && to?.constructor?.name === 'GainNode') onSlot(to)
    return result
  }
  AudioNode.prototype.connect = wrapper
  return () => {
    if (AudioNode.prototype.connect === wrapper) AudioNode.prototype.connect = original
    delete globalThis.__meetingAudioBoosterWorkletHook
  }
}

export function createPooledSlot(gain, id) {
  const baseGain = readAudioParam(gain.gain)
  return {
    id, gain, baseGain, appliedMultiplier: 1, targetValue: baseGain, lastWriteAt: 0,
    // A pooled slot is deliberately never assigned a participant identity.
    participantKey: null,
    set(multiplier, immediate = false) {
      const safe = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1
      const target = baseGain * safe
      const actual = Number(gain?.gain?.value)
      const now = performance.now()
      this.appliedMultiplier = safe
      this.targetValue = target
      this.participantKey = null
      // At neutral, Meet must retain ownership of later slot changes. In
      // particular, it may mute a local presentation slot after connection;
      // repeatedly forcing baseGain would make that local copy audible.
      if (!immediate && safe === 1) return
      if (!immediate && Number.isFinite(actual) && Math.abs(actual - target) <= 0.002 && now - this.lastWriteAt < 90) return
      writeAudioParam(gain.gain, target)
      this.lastWriteAt = now
    },
    neutral(immediate = true) { this.set(1, immediate) }
  }
}
