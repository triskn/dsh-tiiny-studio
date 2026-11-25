// Input is the display size decoded by the browser, never a draft size or a guessed file orientation.
export default function previewProportionsTools() {
  function referenceFit(video, reference) {
    if (![video?.width, video?.height, reference?.width, reference?.height].every(n => Number.isSafeInteger(n) && n > 0)) return null
    const ratio = reference.width / reference.height, exported = video.width / video.height
    // Ignore normal encoder rounding (e.g. 854 × 480 versus 16:9).
    if (Math.max(ratio, exported) / Math.min(ratio, exported) <= 1.02) return null
    let a = reference.width, b = reference.height
    while (b) [a, b] = [b, a % b]
    const label = `${reference.width / a}:${reference.height / a}`
    // A preview-only correction can shorten a stretched axis, but needn't upscale either one.
    return { ratio, label, maxWidth: Math.min(video.width, video.height * ratio) }
  }
  return { referenceFit }
}
