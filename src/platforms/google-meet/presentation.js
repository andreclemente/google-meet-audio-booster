const HOOK_KEY = '__meetingAudioBoosterDisplayCaptureHook'

export function installLocalPresentationCaptureHook(onActive, mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices) return () => {}
  const owner = Object.getPrototypeOf(mediaDevices) || mediaDevices
  const original = owner.getDisplayMedia
  if (typeof original !== 'function' || owner[HOOK_KEY]) return () => {}

  const wrapped = async function (...args) {
    const stream = await original.apply(this, args)
    const videoTracks = stream?.getVideoTracks?.() || []
    const tracks = videoTracks.length ? videoTracks : (stream?.getTracks?.() || [])
    const checkEnded = () => {
      if (tracks.length && tracks.every(track => track.readyState === 'ended')) onActive(false)
    }
    for (const track of tracks) track.addEventListener?.('ended', checkEnded, { once: true })
    onActive(true)
    return stream
  }

  owner[HOOK_KEY] = wrapped
  owner.getDisplayMedia = wrapped

  return () => {
    if (owner.getDisplayMedia === wrapped) owner.getDisplayMedia = original
    if (owner[HOOK_KEY] === wrapped) delete owner[HOOK_KEY]
  }
}
