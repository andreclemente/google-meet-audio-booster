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
    id, gain, baseGain, nativeValue: baseGain, appliedMultiplier: 1, targetValue: baseGain, lastWriteAt: 0, modified: false,
    // A pooled slot is deliberately never assigned a participant identity.
    participantKey: null,
    set(multiplier, immediate = false) {
      const safe = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1
      const actual = readAudioParam(gain.gain)
      if (!this.modified || Math.abs(actual - this.targetValue) > 0.002) this.nativeValue = actual
      const target = this.nativeValue * safe
      const now = performance.now()
      this.appliedMultiplier = safe
      this.targetValue = target
      this.participantKey = null
      // Discovery and idle routing must not touch Meet's own pooled gain. If
      // Meet changes it (notably to 0 for self-presentation), that native value
      // becomes the new baseline and is never overwritten by a multiplier.
      if (Math.abs(actual - target) <= 0.002) {
        this.modified = Math.abs(target - this.nativeValue) > 0.002
        return
      }
      if (safe === 1 && !this.modified) return
      if (!immediate && now - this.lastWriteAt < 90) return
      writeAudioParam(gain.gain, target)
      this.modified = Math.abs(target - this.nativeValue) > 0.002
      this.lastWriteAt = now
    },
    release() {
      const actual = readAudioParam(gain.gain)
      if (this.modified && Math.abs(actual - this.targetValue) > 0.002) this.nativeValue = actual
      if (this.modified && Math.abs(actual - this.nativeValue) > 0.002) writeAudioParam(gain.gain, this.nativeValue)
      this.appliedMultiplier = 1
      this.targetValue = this.nativeValue
      this.participantKey = null
      this.modified = false
    },
    neutral(immediate = true) { this.set(1, immediate) }
  }
}
