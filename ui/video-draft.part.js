// Kept self-contained so the build can inline the same functions tested in Node into the browser module.
export default function videoDraftTools() {
  const emptyVideo = { prompt: '', size: '', seconds: null, frameMode: 'first', reference: null }
  const frameOf = job => job.frameMode === 'last' ? 'last' : 'first'
  const missingFrame = job => job?.kind !== 'image' && (job.retryCode === 'frame_missing' || Boolean(job.frameMode) && !job.frameAssetId)

  // An image is a visual reference, never a source of text for the motion prompt.
  function withSavedFrame(draft, { assetId, file }, frameMode) {
    return { ...draft, frameMode, reference: { type: 'asset', id: assetId, name: file || '' } }
  }
  function draftFromJob(job, forceMissing = false) {
    const reference = forceMissing || missingFrame(job) ? { type: 'missing' }
      : job.frameAssetId ? { type: 'asset', id: job.frameAssetId } : null
    return { prompt: job.prompt || '', size: job.size || '', seconds: job.seconds ?? null, frameMode: frameOf(job), reference }
  }
  function promptField(mode, draft) {
    if (mode === 'image') return { label: 'imagePrompt', placeholder: 'imagePlaceholder' }
    if (!['asset', 'upload'].includes(draft.reference?.type)) return { label: 'videoPrompt', placeholder: 'videoPlaceholder' }
    return frameOf(draft) === 'last'
      ? { label: 'motionPrompt', placeholder: 'lastMotionExample', hint: 'lastMotionHint' }
      : { label: 'motionPrompt', placeholder: 'firstMotionExample', hint: 'firstMotionHint' }
  }
  function videoRequest(video, size, seconds) {
    const prompt = video.prompt.trim()
    // A missing frame or an empty field (only the example is visible) is never a submission.
    if (video.reference?.type === 'missing' || !prompt) return null
    const body = { kind: 'video', prompt, size, seconds }
    if (video.reference) {
      body.frameMode = video.frameMode
      if (video.reference.type === 'asset') body.imageAssetId = video.reference.id
      else body.imageDataUrl = video.reference.dataUrl
    }
    return body
  }
  return { emptyVideo, frameOf, missingFrame, withSavedFrame, draftFromJob, promptField, videoRequest }
}
