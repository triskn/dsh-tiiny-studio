(React, drafts, feedback, { referenceFit }) => {
    const { createElement: h, useCallback, useEffect, useRef, useState } = React
    const { confirmedRemoval, historyIsEmpty } = feedback
    const { emptyVideo, frameOf, missingFrame, withSavedFrame, draftFromJob, promptField, videoRequest } = drafts
    const ROOT = '/tiiny-video'
    const MAX_FRAME_BYTES = 16 * 1024 * 1024
    const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']

    // Studio is English-only, independently of the surrounding Harness.
    const copy = {
      createVideo: 'Video draft', createImage: 'Image draft',
      useThree: 'Use as 3D reference', model3d: '3D model',
      settings: 'Image & video connection', back: 'Back to create',
      create: 'Create', video: 'Video', image: 'Image', outputType: 'What to generate',
      videoPrompt: 'Video prompt', imagePrompt: 'Image prompt',
      videoPlaceholder: 'Describe the shot: what moves, and how does the camera follow?',
      motionPrompt: 'Action and camera movement',
      firstMotionHint: 'This image sets the first frame. What happens next?',
      lastMotionHint: 'This image is the ending reference. How does the shot get there?',
      firstMotionExample: 'For example: Slowly push in as the background slips out of focus.',
      lastMotionExample: 'For example: Start wide and move closer, settling on this composition.',
      needMotion: 'Describe a movement or camera change before generating.',
      imagePlaceholder: 'Describe the subject, setting and light in a single frame…',
      prompt: 'Prompt', needPrompt: 'Write a prompt before generating.',
      size: 'Resolution', duration: 'Duration', secondsValue: '{n} s',
      shapeUnavailable: 'The saved resolution or duration is not available. Choose an offered combination.',
      notOffered: '{value} (unavailable)',
      reference: 'Reference frame (optional)', textOnly: 'Text only',
      drop: 'Choose or drop an image', fileTypes: 'PNG, JPEG or WebP · up to 16 MiB',
      makeImage: 'Generate a reference image', replace: 'Replace image', remove: 'Remove image',
      placement: 'Use image as', first: 'First frame', last: 'Last frame',
      lastHint: 'The device uses this as the ending reference; the last frame may not match exactly.',
      lastUnsupported: 'This host does not support a last frame. Select the first frame or update the plugin.',
      useFirst: 'Use as first frame', useLast: 'Use as last frame',
      savedFrame: 'Saved reference image', readingFrame: 'Reading image…',
      badImage: 'Choose a PNG, JPEG or WebP image of 16 MiB or less.',
      readImageError: 'Could not read the image. Choose it again.',
      missingFrame: 'The original {frame} is unavailable. Reattach an image or explicitly switch to text only.',
      switchText: 'Switch to text only', textConfirmed: 'This video draft now uses the prompt only.',
      generateVideo: 'Generate video', generateImage: 'Generate image', starting: 'Starting…',
      waitActive: 'A job is running. You can edit a draft while it finishes.',
      busyAtSubmit: 'The device was busy when you submitted. No new job was started. Try again after the current operation finishes.',
      unconfirmedLoad: 'The device did not confirm the outcome of a previous 3D model load. No new job was started.',
      unconfirmedTask: 'The device did not confirm whether a previous 3D task ended. No new job was started.',
      affectedModel: 'Model: {model}.',
      reviewSteps: 'Open 3D to recheck. If the warning remains, verify in TiinyOS that there are no tasks or model loads before confirming the device is idle.',
      openThreeStatus: 'Check 3D status',
      needKey: 'Add your Tiiny API key in connection settings before generating.',
      loadingSettings: 'Reading connection settings…', settingsError: 'Could not read connection settings.',
      reload: 'Try again', baseUrl: 'API base URL', apiKey: 'API key',
      keepKey: 'A key is saved. Leave blank to keep it.', enterKey: 'Enter your Tiiny API key',
      newKey: 'The device address changed. Enter a key for the new origin; the saved key will not be reused.',
      badUrl: 'Enter an http:// or https:// API URL without embedded credentials, a query or a fragment.',
      outputDir: 'Output folder for images and videos', models: 'Models', refreshModels: 'Refresh model list',
      olderHost: 'The previous Tiiny Video host is still running. Restart Harness after updating the plugin, then reload this panel to use images and retry.',
      loadHelp: 'To load or switch a model, use the model manager on your Tiiny, then refresh here. This list does not load models.',
      outputMissing: 'The output file is no longer in its saved folder. This history entry still holds the original request.',
      noSavedImage: 'There is no saved reference for this image. To use it in a video, attach an image in the video draft.',
      newJob: 'New {kind} job started. It is separate from the original attempt.',
      jobOutcome: '{kind} · {status}', viewResult: 'View result',
      resolvingModel: 'Checking the device model',
      checking: 'Reading models…', saveForList: 'Save connection changes to see models from the new connection.',
      modelsNeedKey: 'Save an API key to read the device model list. You can still enter model IDs manually.',
      modelsError: 'Could not read the device model list. Enter an exact ID manually, or refresh.',
      noModels: 'No models were reported. You can enter a model ID manually.',
      modelList: 'Models reported by the saved connection ({n})',
      modelHint: 'Leave a model on Automatic or select its exact device ID. Being listed does not mean a model is loaded.',
      videoModel: 'Video model', imageModel: 'Image model', modelId: 'Exact model ID',
      automatic: 'Automatic', manual: 'Enter an ID manually…', other: 'Other', unknownKind: 'Type unknown',
      loaded: 'Loaded', notLoaded: 'Not loaded', loadUnknown: 'Load state unknown',
      save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.',
      saveError: 'Could not save settings.', discardSettings: 'Discard unsaved connection settings?',
      active: 'In progress', history: 'Image & video history', refreshHistory: 'Refresh history',
      loadingJobs: 'Reading jobs…', jobsError: 'Could not read the job list.',
      pendingStatus: 'Status is temporarily unavailable. Checking again; no new job will be submitted.',
      empty: 'No items in history.', dismissDeletion: 'Dismiss message',
      more: 'Show more ({n} remaining)',
      running: 'Running', queued: 'Queued', submitting: 'Submitting', rendering: 'Rendering',
      downloading: 'Saving output', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
      elapsed: 'Elapsed {time}', cancel: 'Cancel job', cancelling: 'Cancelling…',
      cancelImageHint: 'Cancellation stops the local job. The image may still render on the device.',
      cancelSent: 'Cancellation requested. Waiting for the job status.', cancelError: 'Could not confirm cancellation.',
      noPrompt: 'No saved prompt', noRecipe: 'This file has no saved generation settings. It cannot be retried.',
      storedError: 'Error from this attempt (history, not the current device state)',
      details: 'Details', hideDetails: 'Hide details', retry: 'Retry', edit: 'Edit / reuse',
      retryHint: 'Start a new job with this saved request.', reused: 'Copied to the draft. Edit it, then generate when ready.',
      startError: 'Could not start the job.', uncertain: 'Submission could not be confirmed. Refresh history before trying again.',
      model: 'Model used', frame: 'Frame', output: 'Output', imagePreview: 'Generated image',
      videoPreview: 'Generated video', previewProportions: 'Preview proportions',
      asExported: 'As exported ({size})', matchReference: 'Match reference ({size})',
      previewProportionsHint: 'Only changes this preview. Fullscreen and downloads use the exported proportions.',
      download: 'Download', deleting: 'Deleting…',
      fileOnly: 'Library file', savedOutput: 'Library output', outputDeleted: 'Output deleted. The saved request is still in history.',
      missingLibraryFile: 'The exported file is no longer in its saved folder.',
      deleteJob: 'Delete job', deleteOutput: 'Delete output', deleteFile: 'Delete file', deleteBoth: 'Delete job and output',
      removeLibrary: 'Remove library entry', confirmForget: 'Remove this unavailable library entry?', forgetImpact: 'No file will be deleted. This only removes the unavailable item from the library.',
      unavailableOutput: 'Unavailable output', forgotLibrary: 'Unavailable library entry removed. No file was deleted.',
      confirmJob: 'Delete this job?', confirmOutput: 'Delete this output?', confirmFile: 'Delete this file?',
      cancelDialog: 'Cancel', dismiss: 'Close', alsoDeleteOutput: 'Also delete the output', alsoDeleteFile: 'Also delete the exported file',
      outputImpact: 'Removes this result from the job. Its prompt, settings and saved inputs stay in history for reuse.',
      libraryImpact: 'Removes this saved output from the library.', exportImpact: 'The exported file will also be permanently deleted from its output folder.',
      fileImpact: 'Permanently deletes this file from its output folder. There is no saved job for this file.',
      jobImpact: 'Permanently removes this job, its saved prompt, settings and input links. You will no longer be able to retry it from history.',
      sharedImpact: 'Original uploads and copies used by other saved jobs are not deleted.',
      keepLibrary: 'The output will stay in your library, without the job.', keepExport: 'The exported file will also stay in its output folder.',
      deleteLibrary: 'The output will be removed from your library.', noUndo: 'This cannot be undone.',
      deleteError: 'Could not delete this item.', deleteUnknown: 'The deletion was not confirmed. Refresh history before trying again; no second request was sent.',
      removalChanged: 'This item changed. Close this dialog, refresh history, and select it again.',
      removalBusy: 'This job is still active, or its device outcome has not been confirmed. It cannot be deleted yet.',
      removalUnavailable: 'Update the Studio host to manage this item safely.',
      outputRemoved: 'Output deleted. The job and its saved inputs were kept.', libraryRemoved: 'Library output deleted.', fileRemoved: 'File deleted.',
      jobRemoved: 'Job deleted.', jobAndOutputRemoved: 'Job and output deleted.', jobRemovedKept: 'Job deleted. The output was kept in your library.',
      jobId: 'Job ID', exportPath: 'Exported file location', keepEditing: 'Keep editing', discardChanges: 'Discard changes',
      historicalFailure: 'The device reported an error during this attempt. Check its settings in TiinyOS before retrying.',
      modelUnavailable: 'The selected model was not ready for this attempt. Check the exact model and device in TiinyOS before retrying.',
      shapeFailure: 'The device did not support the requested resolution or duration. Edit the draft and choose an available combination.',
      deviceConnectionError: 'The device could not be reached. Check the device address and connection.',
      historicalBusy: 'The device was busy at the time of this attempt.', retryUnavailable: 'This saved request cannot be retried.',
      catalogWarning: 'Studio could not verify the full model list. Refresh the connection or enter an exact model ID.',
    }
    const dictionary = () => copy

    // Scoped to this panel: no host DOM, global styles or custom overlay.
    const css = `
      .tv-page { box-sizing:border-box; height:100%; min-width:0; overflow:auto; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font:inherit; font-size:14px; line-height:1.45; }
      .tv-page *, .tv-page *::before, .tv-page *::after { box-sizing:border-box; }
      .tv-body { display:grid; gap:22px; max-width:960px; margin:0 auto; padding:16px clamp(14px,4vw,48px) 48px; }
      .tv-page :is(h1,h2,h3,p,dl,dd,fieldset,ul) { margin:0; }
      .tv-page h1 { font-size:24px; line-height:1.25; font-weight:650; } .tv-page h2 { font-size:17px; font-weight:600; } .tv-page h3 { font-size:14px; font-weight:600; }
      .tv-head, .tv-row { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; min-width:0; } .tv-head { justify-content:space-between; gap:12px; }
      .tv-grow { flex:1 1 220px; min-width:0; } .tv-stack { display:grid; gap:12px; min-width:0; } .tv-tight { display:grid; gap:4px; min-width:0; }
      .tv-card { display:grid; gap:16px; min-width:0; padding:clamp(12px,2.3vw,22px); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
      .tv-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr)); gap:12px; }
      .tv-page :is(label,fieldset) { min-width:0; } .tv-page fieldset { padding:0; border:0; } .tv-field { display:grid; gap:5px; font-weight:550; }
      .tv-page :is(textarea,select,input:not([type=radio]):not([type=file]):not([type=checkbox])) { width:100%; max-width:100%; min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; padding:7px 9px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; font-weight:400; }
      .tv-page textarea { display:block; min-height:78px; resize:vertical; } .tv-page :is(input,textarea)::placeholder { color:var(--dsw-alias-label-secondary); }
      .tv-page :is(input[type=checkbox],input[type=radio],progress) { accent-color:var(--dsw-alias-brand-primary); } .tv-page progress { width:100%; height:8px; }
      .tv-btn, .tv-page summary { cursor:pointer; font:inherit; } .tv-btn { display:inline-flex; justify-content:center; align-items:center; min-height:34px; padding:6px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); text-decoration:none; }
      .tv-primary { background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); border-color:var(--dsw-alias-label-primary); font-weight:600; }
      .tv-plain { border:0; background:none; color:var(--dsw-alias-brand-primary); padding:4px; } .tv-danger { color:var(--dsw-alias-state-error-primary); }
      .tv-page :is(button,input,select,textarea):disabled { opacity:.58; cursor:not-allowed; } .tv-page :is(button,summary,input,select,textarea,a):focus-visible, .tv-pick:focus-within { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      @media (hover:hover) { .tv-btn:not(:disabled):hover, .tv-summary:hover, .tv-page summary:hover, .tv-pick:hover { text-decoration:underline; text-underline-offset:3px; } }
      @media (pointer:coarse) { .tv-page :is(input,textarea,select) { font-size:16px; } .tv-btn, .tv-pick { min-height:42px; } }
      .tv-segment { display:inline-flex; align-items:center; gap:3px; flex-wrap:wrap; border:1px solid var(--dsw-alias-border-l1); padding:3px; border-radius:8px; background:var(--dsw-alias-bg-base); }
      .tv-segment label { position:relative; cursor:pointer; } .tv-segment span { display:block; padding:5px 14px; border:1px solid transparent; border-radius:5px; }
      .tv-segment input:checked + span { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l2); font-weight:600; }
      .tv-segment input:focus-visible + span { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .tv-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
      .tv-muted, .tv-meta { color:var(--dsw-alias-label-secondary); } .tv-meta { font-size:12px; } .tv-notice { padding:9px 12px; border-inline-start:3px solid var(--dsw-alias-brand-primary); background:var(--dsw-alias-bg-layer-2); border-radius:4px; }
      .tv-error { color:var(--dsw-alias-state-error-primary); } .tv-errorbox { border-inline-start-color:var(--dsw-alias-state-error-primary); } .tv-warning { border-inline-start-color:var(--dsw-alias-state-warn-primary); }
      .tv-text { white-space:pre-wrap; overflow-wrap:anywhere; } .tv-body { overflow-wrap:anywhere; }
      .tv-drop { padding:10px 12px; border:1px dashed var(--dsw-alias-border-l2); border-radius:8px; } .tv-drop[data-over=true] { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-bg-layer-2); }
      .tv-pick { position:relative; } .tv-thumb { width:76px; height:60px; border-radius:6px; object-fit:contain; background:var(--dsw-alias-bg-base); }
      .tv-record { display:grid; grid-template-columns:minmax(0,1fr); gap:10px; min-width:0; padding:12px 0; border-top:1px solid var(--dsw-alias-border-l1); } .tv-record:last-child { padding-bottom:0; }
      .tv-dialog { box-sizing:border-box; width:min(460px,calc(100% - 28px)); max-height:calc(100% - 28px); overflow:auto; margin:auto; padding:20px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:12px; }
      .tv-dialog::backdrop { background:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent); }
      .tv-dialog .tv-choice { display:flex; gap:8px; align-items:flex-start; font-weight:550; }
      .tv-dialog .tv-choice input { flex:none; width:16px; height:16px; margin:3px 0 0; }
      .tv-delete-name { min-width:0; overflow-wrap:anywhere; } .tv-danger-final { color:var(--dsw-alias-state-error-primary); border-color:currentColor; font-weight:600; }
      .tv-summary { display:grid; gap:4px; width:100%; min-width:0; text-align:start; padding:2px; border:0; background:none; color:inherit; cursor:pointer; font:inherit; }
      .tv-clip { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:550; } .tv-tag { font-size:12px; font-weight:600; } .tv-ok { color:var(--dsw-alias-state-success-primary); }
      .tv-details { --tv-preview-max-height:min(60vh,560px); display:grid; grid-template-columns:minmax(0,1fr); min-width:0; gap:10px; padding:12px; border-radius:8px; background:var(--dsw-alias-bg-base); } .tv-facts { display:flex; flex-wrap:wrap; gap:6px 20px; }
      .tv-page dt { font-size:12px; color:var(--dsw-alias-label-secondary); }
      /* Both axes stay intrinsic: size the element (including native controls), not just the picture inside it. */
      .tv-details .tv-media { display:block; place-self:start center; width:auto; height:auto; min-width:0; min-height:0; max-width:100%; max-height:var(--tv-preview-max-height); aspect-ratio:auto; object-fit:contain; border-radius:7px; background:var(--dsw-alias-bg-layer-2); }
      /* The optional correction changes the picture's box; do not transform/crop the native controls. */
      .tv-details .tv-media[data-reference-fit] { width:min(100%,var(--tv-ref-max-width),calc(var(--tv-preview-max-height) * var(--tv-ref-ratio))); aspect-ratio:var(--tv-ref-ratio); object-fit:fill; }
      .tv-details video.tv-media:is(:fullscreen, :-webkit-full-screen) { width:100%; height:100%; max-width:none; max-height:none; aspect-ratio:auto; object-fit:contain; border-radius:0; }
      .tv-preview-choice { display:grid; gap:4px; min-width:0; } .tv-preview-choice label { justify-self:start; max-width:100%; }
      .tv-catalog { padding:0; list-style:none; max-height:220px; overflow:auto; } .tv-catalog li { display:flex; justify-content:space-between; flex-wrap:wrap; gap:3px 10px; padding:5px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
    `

    class ApiError extends Error {
      constructor(status, message, code, model) { super(message); this.status = status; this.code = code; this.model = typeof model === 'string' ? model.trim() : '' }
    }
    async function api(path, { body, signal } = {}) {
      const response = await fetch(ROOT + path, body === undefined ? { signal, cache: 'no-store' } : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
      })
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new ApiError(response.status, (typeof value?.error === 'string' && value.error) || `HTTP ${response.status}`, value?.code, value?.model)
      if (value === null) throw new Error(`Invalid response from ${ROOT}${path}`)
      // A successful GET can describe a failed job: its error is *historical*, not a failed HTTP request.
      return value
    }
    // Old jobs may contain localized Host/device diagnostics. Summarize those on display only;
    // never pass user prompts, model IDs, filenames or uploaded media through this filter.
    const englishDetail = (value, fallback = '') => typeof value === 'string' && !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value) ? value : fallback
    const message = (cause) => englishDetail(String(cause?.message || cause || ''), cause?.status ? `HTTP ${cause.status}` : 'Request failed.')
    function storedError(t, job) {
      const raw = String(job.error || '')
      if (job.errorCode === 'model_not_running' || /model_not_loaded|not (?:currently )?loaded/i.test(raw)) return t('modelUnavailable')
      if (job.errorCode === 'device_busy' || /Studio busy:/i.test(raw)) return t('historicalBusy')
      if (job.errorCode === 'invalid_shape' || /audio=\d+|cond_video=|exported bucket|\u5df2\u5bfc\u51fa/i.test(raw)) return t('shapeFailure')
      if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(raw)) return t('deviceConnectionError')
      return englishDetail(raw) || t('historicalFailure')
    }
    const kindOf = (job) => job?.kind === 'image' ? 'image' : 'video'
    const stageOf = (job) => job.phase === 'cancelling' ? 1 : job.status === 'running' ? 0 : 2
    const ongoing = (job) => stageOf(job) < 2
    const statusOf = (job) => job.phase === 'cancelling' ? 'cancelling' : job.status === 'failed' && job.error === 'cancelled' ? 'cancelled' : job.status
    const assetUrl = (id) => `${ROOT}/asset/${encodeURIComponent(id)}`
    const outputUrl = (job) => job.outputDeleted || job.hasOutput === false ? '' : kindOf(job) === 'image' && job.assetId ? assetUrl(job.assetId)
      : typeof job.url === 'string' && /^\/tiiny-video\/(file|asset)\//.test(job.url) ? job.url : ''
    const standalone = (job) => typeof job?.id === 'string' && job.id.startsWith('file:')
    const forgetOnly = (item) => standalone(item) && item.hasOutput === false && item.canForget === true
    const offersOutputRemoval = (item) => item.hasOutput === true || forgetOnly(item)
    const removalKey = (item, scope) => scope === 'job' ? 'deleteJob' : forgetOnly(item) ? 'removeLibrary' : standalone(item) && !item.assetId ? 'deleteFile' : 'deleteOutput'
    const hasRemovalView = (item) => typeof item?.hasOutput === 'boolean' && typeof item.hasExport === 'boolean' && typeof item.deletionBlocked === 'boolean'
    const canRemove = (item, scope) => hasRemovalView(item) && !ongoing(item) && !item.deletionBlocked &&
      (scope === 'job' ? !standalone(item) : scope === 'output' && (item.hasOutput && !item.outputDeleted || forgetOnly(item)))
    const removalReason = (t, item) => !hasRemovalView(item) ? t('removalUnavailable') : item.deletionBlocked || ongoing(item) ? englishDetail(item.deletionBlockReason) || t('removalBusy') : ''
    const sameRemovalTarget = (before, now) => Boolean(now && ['id', 'assetId', 'file', 'exportPath', 'outputToken', 'hasOutput', 'hasExport'].every((k) => before[k] === now[k]))
    function removalRequest(item, scope, removeOutput) {
      if (!canRemove(item, scope)) return null
      return { id: item.id, scope, ...(scope === 'job' ? { deleteOutput: removeOutput === true && item.hasOutput } : {}),
        ...(scope === 'output' || removeOutput === true && item.hasOutput ? { outputToken: item.outputToken || '' } : {}) }
    }
    const hasRecipe = (job) => typeof job.prompt === 'string' && Boolean(job.prompt.trim()) && !String(job.id).startsWith('file:')
    const hasImages = (settings) => Boolean(settings && (settings.supportsImages ?? typeof settings.imageModel === 'string'))
    const hasRetry = (settings) => Boolean(settings && (settings.supportsRetry ?? hasImages(settings)))
    const canRetry = (job) => !ongoing(job) && job.canRetry !== false && hasRecipe(job) && !missingFrame(job)
    const clock = (time) => {
      const date = new Date(time)
      return time && Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', year: 'numeric' }) : ''
    }
    const button = (text, props = {}) => h('button', { type: 'button', className: 'tv-btn', ...props }, text)
    const note = (text, style = 'info') => text ? h('p', { className: `tv-notice tv-text ${style === 'error' ? 'tv-errorbox' : style === 'warning' ? 'tv-warning' : ''}`, role: style === 'error' ? 'alert' : 'status' }, text) : null
    const feedbackText = (t, notice) => notice ? [t(notice.key, notice.params), notice.detail].filter(Boolean).join(' ') : ''
    // A previous, unconfirmed outcome is not evidence of a job running now. Never use free-form device errors to infer which one happened.
    function admissionNotice(error, recordId) {
      if (error.status !== 409) return null
      if (error.code === 'device_busy') return { admission: true, key: 'busyAtSubmit', recordId }
      if (error.code !== 'studio_recovery_load' && error.code !== 'studio_recovery_task') return null
      return { admission: true, recovery: true, key: error.code === 'studio_recovery_load' ? 'unconfirmedLoad' : 'unconfirmedTask', model: error.model, recordId }
    }
    function renderNotice(t, notice, onCheck3D) {
      if (!notice?.recovery) return note(feedbackText(t, notice), notice?.style)
      return h('div', { className: 'tv-notice tv-warning tv-stack' },
        h('p', { className: 'tv-text', role: 'status' }, [t(notice.key), notice.model ? t('affectedModel', { model: notice.model }) : '', t('reviewSteps')].filter(Boolean).join(' ')),
        h('div', null, button(t('openThreeStatus'), { onClick: onCheck3D })))
    }
    const validJob = (job) => job && typeof job.id === 'string' && ['running', 'completed', 'cancelled', 'failed'].includes(job.status)
    const ordered = (items) => items.sort((a, b) => (Number(b.finishedAt || b.createdAt) || 0) - (Number(a.finishedAt || a.createdAt) || 0))

    /** Job snapshots belong to their IDs. Inspecting a history row never changes what is polled. */
    function useJobs(ownLease) {
      const [items, setItems] = useState([])
      const [read, setRead] = useState({ busy: true, ready: false, error: '' })
      const [pollError, setPollError] = useState('')
      const listRequest = useRef(null)
      const version = useRef(0)
      const changed = useRef(new Map())
      const accept = useCallback((job) => {
        if (!validJob(job)) return
        changed.current.set(job.id, ++version.current)
        setItems((current) => {
          const old = current.find((x) => x.id === job.id)
          if (old && stageOf(old) > stageOf(job)) return current
          return ordered([job, ...current.filter((x) => x.id !== job.id)])
        })
      }, [])
      const forget = useCallback((id) => {
        changed.current.set(id, ++version.current)
        setItems((current) => current.filter((x) => x.id !== id))
      }, [])
      const refresh = useCallback(async () => {
        listRequest.current?.abort()
        const request = new AbortController()
        listRequest.current = request
        const startedAt = version.current
        setRead((old) => ({ ...old, busy: true }))
        try {
          const result = await api('/jobs', { signal: request.signal })
          if (request.signal.aborted) return false
          if (!Array.isArray(result.jobs)) throw new Error('Invalid /jobs response')
          // A slow disk scan must not erase a job started, cancelled, polled or deleted since it began.
          setItems((current) => {
            const incoming = new Map(result.jobs.filter(validJob).map((j) => [j.id, j]))
            for (const [id, at] of changed.current) {
              if (at <= startedAt) continue
              const newer = current.find((j) => j.id === id)
              if (newer) incoming.set(id, newer); else incoming.delete(id)
            }
            for (const row of current) if (incoming.has(row.id) && stageOf(row) > stageOf(incoming.get(row.id))) incoming.set(row.id, row)
            return ordered([...incoming.values()])
          })
          setRead({ ready: true, busy: false, error: '' })
          return true
        } catch (cause) {
          if (!request.signal.aborted) setRead((old) => ({ ...old, busy: false, error: message(cause) }))
          return false
        }
      }, [])
      useEffect(() => { void refresh(); return () => listRequest.current?.abort() }, [refresh, ownLease])
      const running = items.filter(ongoing)
      const watch = JSON.stringify(running.map((j) => j.id).sort())
      useEffect(() => {
        const ids = JSON.parse(watch)
        setPollError('')
        if (!ids.length) return
        const request = new AbortController()
        let timer
        const tick = async () => {
          let problem = '', missing = false
          await Promise.all(ids.map(async (id) => {
            try {
              const job = await api(`/job?id=${encodeURIComponent(id)}`, { signal: request.signal })
              if (!validJob(job) || job.id !== id) throw new Error('Invalid /job response')
              if (!request.signal.aborted) accept(job)
            } catch (cause) { if (cause.status === 404) missing = true; problem = message(cause) }
          }))
          if (request.signal.aborted) return
          setPollError(problem)
          if (missing) await refresh() // A restarted Host may only know a job through durable history.
          if (!request.signal.aborted) timer = setTimeout(tick, problem ? 4000 : 2200)
        }
        timer = setTimeout(tick, 700)
        return () => { request.abort(); clearTimeout(timer) }
      }, [watch, accept, refresh])
      return { items, running, read, pollError, accept, forget, refresh }
    }

    const draftSettings = (s) => ({ baseUrl: s.baseUrl || '', apiKey: '', model: s.model || '', imageModel: s.imageModel || '', outputDir: s.outputDir || '' })
    function originOf(base) {
      try { const url = new URL(base); return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.origin : '' } catch { return '' }
    }
    const modelState = (m) => m.loaded === true ? 'loaded' : m.loaded === false ? 'notLoaded' : 'loadUnknown'
    const modelType = (m) => m.kind === '3d' ? 'model3d' : ['image', 'video', 'other'].includes(m.kind) ? m.kind : 'unknownKind'

    function ModelField({ t, kind, value, onChange, models, disabled }) {
      const [manual, setManual] = useState(false)
      const options = models.filter((m) => m.kind === kind || modelType(m) === 'unknownKind')
      const manualEntry = manual || Boolean(value && !options.some((m) => m.id === value))
      const label = t(kind === 'video' ? 'videoModel' : 'imageModel')
      return h('div', { className: 'tv-tight' },
        h('label', { className: 'tv-field' }, label,
          h('select', { disabled, value: manualEntry ? 'manual' : value ? `id:${value}` : 'auto', onChange: (e) => {
            const v = e.currentTarget.value
            setManual(v === 'manual')
            if (v !== 'manual') onChange(v === 'auto' ? '' : v.slice(3))
          } }, h('option', { value: 'auto' }, t('automatic')),
          options.map((m) => h('option', { key: m.id, value: `id:${m.id}` }, `${m.id} · ${t(modelState(m))}`)),
          h('option', { value: 'manual' }, t('manual')))),
        manualEntry ? h('label', { className: 'tv-field tv-meta' }, `${label} · ${t('modelId')}`,
          h('input', { disabled, value, spellCheck: false, autoCapitalize: 'none', autoComplete: 'off', onChange: (e) => onChange(e.currentTarget.value) })) : null)
    }

    // The browser supplies focus containment and Escape; all visible actions are Studio's English buttons.
    function ConfirmDialog({ id, title, description, children, cancelLabel, confirmLabel, onCancel, onConfirm, busy, blocked }) {
      const dialog = useRef(null), safe = useRef(null)
      useEffect(() => {
        const node = dialog.current
        if (!node.open) node.showModal()
        safe.current?.focus()
        return () => { if (node.open) node.close() }
      }, [])
      return h('dialog', { ref: dialog, className: 'tv-dialog', lang: 'en', role: 'alertdialog', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-body`,
        onCancel: (e) => { e.preventDefault(); if (!busy) onCancel() } },
        h('div', { className: 'tv-stack' }, h('h2', { id: `${id}-title` }, title), h('div', { id: `${id}-body`, className: 'tv-stack' }, description), children,
          h('div', { className: 'tv-row' }, button(cancelLabel, { ref: safe, autoFocus: true, disabled: busy, onClick: onCancel }),
            button(confirmLabel, { className: 'tv-btn tv-danger-final', disabled: busy || blocked, onClick: onConfirm }))))
    }

    function SettingsForm({ t, saved, onSaved, onBack }) {
      const [draft, setDraft] = useState(() => draftSettings(saved))
      const [discard, setDiscard] = useState(false)
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(null)
      const [catalog, setCatalog] = useState({ models: [], busy: false, warning: '', error: '' })
      const loading = useRef(null)
      const savingRef = useRef(false)
      const alive = useRef(false)
      useEffect(() => { alive.current = true; return () => { alive.current = false; loading.current?.abort() } }, [])
      const change = (name, value) => { setDraft((d) => ({ ...d, [name]: value })); setNotice(null) }
      const connectionDirty = draft.baseUrl.trim() !== saved.baseUrl || Boolean(draft.apiKey.trim())
      const changedOrigin = Boolean(saved.hasApiKey && originOf(draft.baseUrl) && originOf(draft.baseUrl) !== originOf(saved.baseUrl))
      const loadModels = useCallback(async () => {
        loading.current?.abort()
        const request = new AbortController()
        loading.current = request
        setCatalog({ models: [], busy: true, error: '', warning: '' })
        try {
          const result = await api('/models', { signal: request.signal })
          if (!Array.isArray(result.models)) throw new Error('Invalid /models response')
          if (!request.signal.aborted) setCatalog({ models: result.models.filter((m) => typeof m?.id === 'string'), busy: false, warning: result.warning || '', error: '' })
        } catch (cause) {
          if (!request.signal.aborted) setCatalog({ models: [], busy: false, warning: '', error: message(cause) })
        }
      }, [])
      useEffect(() => {
        if (saved.hasApiKey) void loadModels()
        else setCatalog({ models: [], busy: false, error: '', warning: '' })
        return () => loading.current?.abort()
      }, [saved, loadModels])
      const save = async (e) => {
        e.preventDefault()
        if (savingRef.current) return
        if (!originOf(draft.baseUrl)) { setNotice({ key: 'badUrl', style: 'error' }); return }
        if (changedOrigin && !draft.apiKey.trim()) { setNotice({ key: 'newKey', style: 'error' }); return }
        savingRef.current = true; setSaving(true); setNotice(null)
        try {
          const patch = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]))
          const next = await api('/settings', { body: patch })
          if (!alive.current) return
          setDraft(draftSettings(next)); setNotice({ key: 'saved' }); onSaved(next)
        } catch (cause) { if (alive.current) setNotice({ key: 'saveError', detail: message(cause), style: 'error' }) }
        finally { savingRef.current = false; if (alive.current) setSaving(false) }
      }
      const back = () => {
        const current = draftSettings(saved)
        if (Object.keys(draft).some((key) => draft[key] !== current[key])) setDiscard(true)
        else onBack()
      }
      const input = (name, label, props = {}) => h('label', { className: 'tv-field' }, t(label), h('input', {
        value: draft[name], onChange: (e) => change(name, e.currentTarget.value), disabled: saving, spellCheck: false, autoCapitalize: 'none', ...props,
      }))
      const available = !connectionDirty && saved.hasApiKey ? catalog.models : []
      return h('form', { className: 'tv-card', noValidate: true, onSubmit: save },
        h('div', { className: 'tv-head' }, h('h2', null, t('settings')), button(t('back'), { onClick: back, disabled: saving })),
        input('baseUrl', 'baseUrl', { type: 'url', required: true, autoComplete: 'off', autoFocus: true }),
        h('div', { className: 'tv-tight' }, input('apiKey', 'apiKey', { type: 'password', autoComplete: 'new-password', 'aria-describedby': 'tv-key-help' }),
          h('p', { id: 'tv-key-help', className: 'tv-meta' }, t(changedOrigin ? 'newKey' : saved.hasApiKey ? 'keepKey' : 'enterKey'))),
        h('div', { className: 'tv-head' }, h('h3', null, t('models')), button(t(catalog.busy ? 'checking' : 'refreshModels'), {
          onClick: loadModels, disabled: saving || catalog.busy || !saved.hasApiKey || connectionDirty,
        })),
        h('div', { className: 'tv-tight' }, h('p', { className: 'tv-muted' }, t('modelHint')), h('p', { className: 'tv-meta' }, t('loadHelp'))),
        connectionDirty ? note(t('saveForList')) : !saved.hasApiKey ? note(t('modelsNeedKey'))
          : catalog.error ? note(`${t('modelsError')} ${catalog.error}`, 'warning') : catalog.warning ? note(englishDetail(catalog.warning) || t('catalogWarning'), 'warning')
          : !available.length && !catalog.busy ? h('p', { className: 'tv-meta' }, t('noModels')) : null,
        h('div', { className: 'tv-grid' }, ['video', 'image'].map((kind) => {
          const name = kind === 'video' ? 'model' : 'imageModel'
          return h(ModelField, { key: name, t, kind, value: draft[name], models: available, disabled: saving, onChange: (v) => change(name, v) })
        })),
        available.length ? h('details', null, h('summary', null, t('modelList', { n: available.length })),
          h('ul', { className: 'tv-catalog', tabIndex: 0 }, available.map((m) => h('li', { key: m.id }, h('span', null, m.id),
            h('span', { className: 'tv-meta' }, `${t(modelType(m))} · ${t(modelState(m))}`))))) : null,
        input('outputDir', 'outputDir', { autoComplete: 'off' }),
        discard ? h(ConfirmDialog, { id: 'tv-discard', title: t('discardSettings'), description: t('back'), cancelLabel: t('keepEditing'), confirmLabel: t('discardChanges'),
          onCancel: () => setDiscard(false), onConfirm: () => { setDiscard(false); onBack() } }) : null,
        notice ? note(feedbackText(t, notice), notice.style) : null,
        h('div', { className: 'tv-row' }, button(t(saving ? 'saving' : 'save'), { type: 'submit', className: 'tv-btn tv-primary', disabled: saving })))
    }

    function Reference({ t, video, update, onPick, onClear, onMakeImage, reading, supportsLast }) {
      const [over, setOver] = useState(false)
      const ref = video.reference
      const hasImage = ref && ref.type !== 'missing'
      return h('fieldset', { className: 'tv-tight' }, h('legend', null, t('reference')),
        h('div', { className: 'tv-drop tv-stack', 'data-over': over,
          onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setOver(true) }, onDragLeave: () => setOver(false),
          onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onPick(e.dataTransfer?.files?.[0]) },
        }, h('div', { className: 'tv-row' },
          hasImage ? h('img', { className: 'tv-thumb', src: ref.type === 'asset' ? assetUrl(ref.id) : ref.dataUrl, alt: ref.name || t('savedFrame') }) : null,
          h('div', { className: 'tv-grow tv-tight' },
            h('div', { className: 'tv-row' },
              h('label', { className: 'tv-btn tv-pick' }, t(hasImage ? 'replace' : 'drop'),
                h('input', { type: 'file', className: 'tv-sr', accept: MIME_TYPES.join(','), onChange: (e) => {
                  const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; onPick(file)
                } })),
              hasImage ? button(t('remove'), { className: 'tv-btn tv-plain', onClick: onClear })
                : button(t('makeImage'), { className: 'tv-btn tv-plain', onClick: onMakeImage })),
            h('p', { className: 'tv-meta' }, reading ? t('readingFrame') : ref?.name || t(hasImage ? 'savedFrame' : 'fileTypes')))),
          ref?.type === 'missing' ? h('div', { className: 'tv-tight' }, note(t('missingFrame', { frame: t(video.frameMode) }), 'warning'),
            h('div', null, button(t('switchText'), { onClick: onClear }))) : null,
          hasImage ? h('div', { className: 'tv-tight' }, h('fieldset', null,
            h('legend', { className: 'tv-meta' }, t('placement')),
            h('div', { className: 'tv-row' }, ['first', 'last'].map((position) => h('label', { key: position },
              h('input', { type: 'radio', name: 'tv-frame-mode', checked: video.frameMode === position, disabled: position === 'last' && !supportsLast,
                onChange: () => update((d) => ({ ...d, frameMode: position })) }), ' ', t(position))))),
            video.frameMode === 'last' ? h('p', { className: 'tv-meta' }, t(supportsLast ? 'lastHint' : 'lastUnsupported')) : null) : null))
    }

    function ActiveJob({ t, job, action, onCancel, cancelRequested }) {
      const phaseKey = ({ queued: 'queued', cancelling: 'cancelling', resolving_model: 'resolvingModel', submitting: 'submitting', in_progress: 'rendering', running: 'rendering', generating: 'rendering',
        processing: 'rendering', downloading: 'downloading', saving: 'downloading' })[job.phase] || 'running'
      const progress = Math.min(100, Math.max(0, Number(job.progress) || 0))
      const elapsed = Math.max(0, Math.floor((Date.now() - Number(job.createdAt)) / 1000))
      const elapsedText = Number.isFinite(elapsed) && job.createdAt ? t('elapsed', { time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` }) : ''
      return h('div', { className: 'tv-stack' }, h('div', { className: 'tv-head' }, h('h3', null, `${t(kindOf(job))} · ${t(phaseKey)}`),
        button(t(cancelRequested || job.phase === 'cancelling' || action?.type === 'cancel' && action.id === job.id ? 'cancelling' : 'cancel'), { disabled: Boolean(action) || job.phase === 'cancelling' || cancelRequested, onClick: () => onCancel(job) })),
        h('p', { className: 'tv-text' }, job.prompt),
        h('progress', { 'aria-label': t(phaseKey), max: 100, value: progress > 0 ? progress : undefined }),
        h('p', { className: 'tv-meta' }, [progress > 0 ? `${progress}%` : '', elapsedText, job.model].filter(Boolean).join(' · ')),
        kindOf(job) === 'image' ? h('p', { className: 'tv-meta' }, t('cancelImageHint')) : null,
        cancelRequested ? note(t('cancelSent')) : null)
    }

    function FrameActions({ t, item, onFrame, onThree, supportsLast }) {
      return h('div', { className: 'tv-row' },
        button(t('useFirst'), { className: 'tv-btn tv-primary', onClick: () => onFrame(item, 'first') }),
        button(t('useLast'), { disabled: !supportsLast, title: supportsLast ? undefined : t('lastUnsupported'), onClick: () => onFrame(item, 'last') }),
        button(t('useThree'), { onClick: () => onThree(item) }))
    }

    function DeleteAction({ t, item, scope, onDelete, action }) {
      const reason = removalReason(t, item), text = t(removalKey(item, scope))
      return button(text + '…', { className: 'tv-btn tv-danger', disabled: Boolean(action) || !canRemove(item, scope), title: reason || undefined,
        onClick: (e) => onDelete(item, scope, e.currentTarget) })
    }
    function OutputActions({ t, item, onDelete, action }) {
      const url = outputUrl(item)
      return h('div', { className: 'tv-row' }, url ? h('a', { className: 'tv-btn', href: url, download: item.file || item.assetId || '' }, t('download')) : null,
        offersOutputRemoval(item) ? h(DeleteAction, { t, item, scope: 'output', onDelete, action }) : null)
    }
    function DeleteDialog({ t, selection, current, busy, onCancel, onConfirm }) {
      const [withOutput, setWithOutput] = useState(false) // Each selection begins with “keep output”.
      const { item, scope } = selection, job = scope === 'job', forget = forgetOnly(item), file = removalKey(item, scope) === 'deleteFile'
      const changed = !sameRemovalTarget(item, current), refused = changed || !canRemove(current, scope)
      const prompt = item.prompt?.trim(), name = item.file || item.name || item.assetId
      const checked = job && item.hasOutput && withOutput
      const removingOutput = !job || checked
      return h(ConfirmDialog, { id: 'tv-removal', title: t(job ? 'confirmJob' : forget ? 'confirmForget' : file ? 'confirmFile' : 'confirmOutput'), cancelLabel: t('cancelDialog'),
        confirmLabel: t(busy ? 'deleting' : checked ? 'deleteBoth' : removalKey(item, scope)), busy, blocked: refused, onCancel, onConfirm: () => onConfirm(checked),
        description: h('div', { className: 'tv-tight' },
          h('strong', { className: 'tv-delete-name' }, `${t(kindOf(item))} · ${name || (prompt ? prompt.slice(0, 96) + (prompt.length > 96 ? '…' : '') : standalone(item) ? t('unavailableOutput') : item.id)}`),
          !standalone(item) ? h('p', { className: 'tv-meta tv-delete-name' }, `${t('jobId')}: ${item.id}`) : null,
          item.hasExport && item.exportPath ? h('p', { className: 'tv-meta tv-delete-name' }, `${t('exportPath')}: ${item.exportPath}`) : null,
          h('p', null, t(job ? 'jobImpact' : forget ? 'forgetImpact' : file ? 'fileImpact' : standalone(item) ? 'libraryImpact' : 'outputImpact'))) },
        job && item.hasOutput ? h('label', { className: 'tv-choice' }, h('input', { type: 'checkbox', checked, disabled: busy || refused, onChange: (e) => setWithOutput(e.currentTarget.checked) }),
          t(item.hasExport && !item.assetId ? 'alsoDeleteFile' : 'alsoDeleteOutput')) : null,
        job && item.hasOutput && !checked ? h('p', null, [t('keepLibrary'), item.hasExport ? t('keepExport') : ''].filter(Boolean).join(' ')) : null,
        checked ? h('p', null, t('deleteLibrary')) : null,
        !file && removingOutput && item.hasExport ? h('p', null, t('exportImpact')) : null,
        !file && !forget ? h('p', { className: 'tv-meta' }, t('sharedImpact')) : null,
        h('p', null, t('noUndo')),
        refused ? note(changed ? t('removalChanged') : removalReason(t, current) || t('removalChanged'), 'warning') : null)
    }

    function DetailVideo({ t, item, url }) {
      const [video, setVideo] = useState(null), [reference, setReference] = useState(null)
      const [match, setMatch] = useState(false) // Always open as exported. A different reference ratio is not proof of distortion.
      const record = (set, width, height) => set(old => old?.width === width && old?.height === height ? old : { width, height })
      const readVideo = e => record(setVideo, e.currentTarget.videoWidth, e.currentTarget.videoHeight)
      const fit = referenceFit(video, reference), adjusted = match && fit
      const hintId = `tv-fit-${encodeURIComponent(item.id)}`
      return h(React.Fragment, null,
        item.frameAssetId ? h('div', { className: 'tv-row' },
          h('img', { className: 'tv-thumb', src: assetUrl(item.frameAssetId), alt: t(frameOf(item)), loading: 'lazy',
            onLoad: e => record(setReference, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight), onError: () => setReference(null) }),
          fit ? h('div', { className: 'tv-preview-choice' },
            h('label', { className: 'tv-field' }, t('previewProportions'), h('select', { value: match ? 'reference' : 'exported', 'aria-describedby': hintId,
              onChange: e => setMatch(e.currentTarget.value === 'reference') },
              h('option', { value: 'exported' }, t('asExported', { size: `${video.width} × ${video.height}` })),
              h('option', { value: 'reference' }, t('matchReference', { size: fit.label })))),
            h('p', { id: hintId, className: 'tv-meta' }, t('previewProportionsHint'))) : null) : null,
        url ? h('video', { className: 'tv-media', src: url, 'aria-label': t('videoPreview'), controls: true, playsInline: true, preload: 'metadata',
          onLoadedMetadata: readVideo, onResize: readVideo, onError: () => setVideo(null), 'data-reference-fit': adjusted ? '' : undefined,
          style: adjusted ? { '--tv-ref-ratio': adjusted.ratio, '--tv-ref-max-width': `${adjusted.maxWidth}px` } : undefined }) : null)
    }

    function JobDetails({ t, item, onFrame, onThree, onDelete, onSettings, supportsLast, action }) {
      const isImage = kindOf(item) === 'image'
      const url = statusOf(item) === 'completed' ? outputUrl(item) : ''
      const facts = [['model', item.model], ...(!isImage ? [
        ['size', item.size], ['duration', item.seconds ? t('secondsValue', { n: item.seconds }) : ''],
        ['frame', item.frameMode || item.frameAssetId ? t(frameOf(item)) : hasRecipe(item) ? t('textOnly') : ''],
      ] : []), ['output', item.file || item.name || (isImage && item.assetId)], ['exportPath', item.hasExport && item.exportPath]]
      return h('div', { className: 'tv-details' },
        !standalone(item) ? h('div', { className: 'tv-tight' }, h('h3', null, t('prompt')), h('p', { className: 'tv-text' }, item.prompt || t('noPrompt'))) : null,
        h('dl', { className: 'tv-facts' }, facts.filter(([, value]) => value).map(([key, value]) => h('div', { key }, h('dt', null, t(key)), h('dd', null, value)))),
        isImage ? url ? h('img', { className: 'tv-media', src: url, alt: t('imagePreview'), loading: 'lazy' }) : null
          : url || item.frameAssetId ? h(DetailVideo, { key: JSON.stringify([item.id, url, item.outputToken, item.frameAssetId]), t, item, url }) : null,
        !item.outputDeleted && (item.outputMissing || statusOf(item) === 'completed' && item.file && !url) ? note(t(standalone(item) ? 'missingLibraryFile' : 'outputMissing'), 'warning') : null,
        url || offersOutputRemoval(item) ? h(OutputActions, { t, item, onDelete, action }) : null,
        isImage && url && item.assetId ? h(FrameActions, { t, item, onFrame, onThree, supportsLast })
          : isImage && url ? h('p', { className: 'tv-meta' }, t('noSavedImage')) : null,
        statusOf(item) === 'failed' && onSettings ? h('div', null, button(t('settings'), { onClick: onSettings })) : null)
    }

    function History({ t, jobs, inspected, setInspected, focusId, onFocused, headingRef, issueRef, removalIssue, onDismissIssue, notice, onCheck3D, blocked, action, onRetry, onReuse, onFrame, onThree, onDelete, onRefresh, onSettings, supportsLast }) {
      const [count, setCount] = useState(6)
      const jumpTarget = useRef(null)
      const items = jobs.items.filter((job) => !ongoing(job))
      const expandedId = inspected === undefined ? items[0]?.id : inspected
      const focusIndex = focusId ? items.findIndex((item) => item.id === focusId) : -1
      const visible = Math.max(count, focusIndex + 1, items.findIndex((item) => item.id === expandedId) + 1)
      useEffect(() => {
        if (!focusId) return
        if (focusIndex >= count) setCount(focusIndex + 1)
        const target = jumpTarget.current || headingRef.current
        target?.focus(); onFocused()
      }, [focusId, focusIndex, count, onFocused, headingRef])
      return h('section', { className: 'tv-card', 'aria-labelledby': 'tv-history-heading' },
        h('div', { className: 'tv-head' }, h('h2', { id: 'tv-history-heading', tabIndex: -1, ref: headingRef }, t('history')), button(t(jobs.read.busy ? 'loadingJobs' : 'refreshHistory'), { disabled: jobs.read.busy, onClick: onRefresh })),
        removalIssue ? h('div', { className: 'tv-notice tv-errorbox tv-row' },
          h('p', { ref: issueRef, tabIndex: -1, role: 'alert', className: 'tv-text tv-grow' }, feedbackText(t, removalIssue), ' ', h('span', { className: 'tv-meta' }, removalIssue.target)),
          button(t('dismissDeletion'), { className: 'tv-btn tv-plain', onClick: onDismissIssue })) : null,
        jobs.read.error ? note(`${t('jobsError')} ${jobs.read.error}`, 'error') : null,
        historyIsEmpty(items.length, jobs.read, action?.type === 'delete', removalIssue) ? h('p', { className: 'tv-muted' }, t('empty')) : null,
        items.slice(0, visible).map((item) => {
          const expanded = item.id === expandedId, status = statusOf(item), recipe = hasRecipe(item)
          const detailsId = `tv-record-${encodeURIComponent(item.id)}`
          const library = standalone(item), deleteHold = removalReason(t, item)
          const reason = library ? '' : !recipe ? t('noRecipe') : missingFrame(item) ? t('missingFrame', { frame: t(frameOf(item)) }) : item.canRetry === false ? englishDetail(item.retryHint) || t('retryUnavailable') : ''
          return h('article', { key: item.id, className: 'tv-record' },
            h('div', { className: 'tv-row' }, h('span', { className: 'tv-tag' }, t(kindOf(item))),
              h('span', { className: `tv-tag ${status === 'failed' ? 'tv-error' : status === 'completed' ? 'tv-ok' : 'tv-muted'}` }, t(library ? item.assetId ? 'savedOutput' : 'fileOnly' : status)),
              h('span', { className: 'tv-meta' }, clock(item.finishedAt || item.createdAt))),
            h('button', { type: 'button', className: 'tv-summary', ref: focusId === item.id ? jumpTarget : undefined, 'aria-expanded': expanded, 'aria-controls': detailsId, onClick: () => setInspected(expanded ? null : item.id) },
              h('span', { className: 'tv-clip' }, item.prompt || item.file || item.name || item.assetId || t(library ? 'unavailableOutput' : 'noPrompt')),
              h('span', { className: 'tv-meta' }, [item.size, item.seconds ? t('secondsValue', { n: item.seconds }) : '', t(expanded ? 'hideDetails' : 'details')].filter(Boolean).join(' · '))),
            status === 'failed' ? h('div', { className: 'tv-notice tv-errorbox' }, h('strong', null, t('storedError')), h('p', { className: 'tv-text' }, storedError(t, item))) : null,
            item.outputDeleted ? h('p', { className: 'tv-meta' }, t('outputDeleted')) : forgetOnly(item) ? h('p', { className: 'tv-meta' }, t('unavailableOutput')) : null,
            !expanded && kindOf(item) === 'image' && status === 'completed' && item.assetId && outputUrl(item) ? h(FrameActions, { t, item, onFrame, onThree, supportsLast }) : null,
            !library || !expanded ? h('div', { className: 'tv-row' }, !library ? button(t(action?.type === 'retry' && action.id === item.id ? 'starting' : 'retry'), { disabled: blocked || !canRetry(item), title: reason || t('retryHint'), onClick: () => onRetry(item) }) : null,
              recipe ? button(t('edit'), { onClick: () => onReuse(item) }) : null,
              !expanded && offersOutputRemoval(item) ? h(DeleteAction, { t, item, scope: 'output', onDelete, action }) : null,
              !library ? h(DeleteAction, { t, item, scope: 'job', onDelete, action }) : null) : null,
            reason || deleteHold ? h('p', { className: 'tv-meta' }, [reason, deleteHold].filter(Boolean).join(' ')) : null,
            notice?.recordId === item.id ? renderNotice(t, notice, onCheck3D) : null,
            h('div', { id: detailsId, hidden: !expanded }, expanded ? h(JobDetails, { t, item, onFrame, onThree, onDelete, onSettings, supportsLast, action }) : null))
        }),
        items.length > visible ? h('div', null, button(t('more', { n: items.length - visible }), { onClick: () => setCount(visible + 6) })) : null)
    }

    function Panel({ t, mode, setMode, visible, onThree, stagedThreeAssetId, onAssetMissing, leased, ownLease, onActivity }) {
      const jobs = useJobs(ownLease)
      const [settings, setSettings] = useState(null)
      const [settingsError, setSettingsError] = useState('')
      const [settingsRead, setSettingsRead] = useState(0)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [imagePrompt, setImagePrompt] = useState('')
      const [video, setVideo] = useState(emptyVideo)
      const [readingFrame, setReadingFrame] = useState(false)
      const [inspected, setInspected] = useState(undefined) // undefined follows the latest result; null closes all details.
      const [trackedId, setTrackedId] = useState('') // Tracks the current run's outcome, not the row being inspected.
      const [resultFocus, setResultFocus] = useState(null)
      const [notice, setNotice] = useState(null)
      const [action, setAction] = useState(null)
      const [selection, setSelection] = useState(null)
      const [removalAnnouncement, setRemovalAnnouncement] = useState('')
      const [removalIssue, setRemovalIssue] = useState(null)
      const removalTrigger = useRef(null), historyHeading = useRef(null), issueText = useRef(null)
      // After confirmation, focus the surviving row or its stable heading, never an invisible receipt.
      useEffect(() => {
        if (selection || !visible || !removalTrigger.current) return
        const { origin, destination, retainedId } = removalTrigger.current; removalTrigger.current = null
        if (retainedId) setResultFocus(retainedId)
        else if (destination === 'issue' && issueText.current) issueText.current.focus()
        else if (destination === 'origin' && origin.isConnected && !origin.disabled) origin.focus()
        else historyHeading.current?.focus()
      }, [selection, visible])
      const [cancelRequested, setCancelRequested] = useState(null)
      const [checkHistory, setCheckHistory] = useState(false)
      const [focusRequest, setFocusRequest] = useState(0)
      const promptInput = useRef(null)
      const focusHandled = useRef(0)
      const lock = useRef(null)
      const mediaVisit = useRef(0)
      useEffect(() => {
        if (!visible) {
          ++mediaVisit.current; removalTrigger.current = null; setSelection(null); setRemovalAnnouncement(''); setResultFocus(null)
          setNotice((current) => current?.admission ? null : current)
        }
      }, [visible])
      const openThreeStatus = () => { setNotice(null); setMode('3d') }
      const reader = useRef(null)
      const alive = useRef(false)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; reader.current?.abort(); reader.current = null }
      }, [])
      useEffect(() => {
        const request = new AbortController()
        setSettingsError('')
        api('/settings', { signal: request.signal }).then((s) => {
          if (!request.signal.aborted) setSettings(s)
        }).catch((cause) => { if (!request.signal.aborted) setSettingsError(message(cause)) })
        return () => request.abort()
      }, [settingsRead])
      // Move keyboard focus only after an explicit “edit/use as frame” action, inside this component.
      useEffect(() => {
        if (visible && focusRequest !== focusHandled.current && promptInput.current) {
          focusHandled.current = focusRequest; promptInput.current.focus()
        }
      }, [visible, focusRequest, settingsOpen])

      const spec = settings?.spec || {}
      const size = video.size || settings?.size || ''
      const seconds = video.seconds ?? settings?.seconds ?? 0
      const options = Object.keys(spec)
      const durations = spec[size] || []
      const validShape = durations.includes(seconds)
      const supportsLast = Boolean(settings?.supportsLastFrame)
      const oldHost = Boolean(settings && (!hasImages(settings) || !hasRetry(settings)))
      const runningId = jobs.running[0]?.id
      useEffect(() => { onActivity() }, [runningId, onActivity])
      useEffect(() => { if (runningId) setTrackedId(runningId) }, [runningId])
      const tracked = jobs.items.find((item) => item.id === trackedId)
      const outcome = tracked && !ongoing(tracked) ? tracked : null
      const field = promptField(mode, video)
      const missing = video.reference?.type === 'missing'
      const cannotLast = Boolean(video.reference && video.frameMode === 'last' && !supportsLast)
      const blocked = Boolean(action || leased || jobs.running.length || !jobs.read.ready || !settings?.hasApiKey || checkHistory || oldHost)
      const composerBlocked = blocked || (mode === 'video' && (missing || readingFrame || !validShape || cannotLast))
      const updateSize = (value) => {
        const valid = spec[value] || []
        setVideo((d) => ({ ...d, size: value, seconds: valid.includes(seconds) ? seconds
          : valid.reduce((a, b) => Math.abs(a - seconds) < Math.abs(b - seconds) ? a : b, valid[0]) }))
      }
      const stopReader = () => { const old = reader.current; reader.current = null; old?.abort(); setReadingFrame(false) }
      const pick = (file) => {
        if (!file) return
        stopReader()
        if (!MIME_TYPES.includes(file.type) || !file.size || file.size > MAX_FRAME_BYTES) { setNotice({ key: 'badImage', style: 'error' }); return }
        const read = new FileReader()
        reader.current = read; setReadingFrame(true); setNotice(null)
        read.onload = () => {
          if (reader.current !== read || !alive.current) return
          setVideo((d) => ({ ...d, reference: { type: 'upload', name: file.name, dataUrl: String(read.result) } }))
          reader.current = null; setReadingFrame(false)
        }
        read.onerror = () => {
          if (reader.current !== read || !alive.current) return
          reader.current = null; setReadingFrame(false); setNotice({ key: 'readImageError', style: 'error' })
        }
        read.readAsDataURL(file)
      }
      const focusDraft = (nextMode) => { setSettingsOpen(false); setMode(nextMode); setFocusRequest((n) => n + 1) }
      const reuse = (item, forceMissing = false) => {
        if (!hasRecipe(item)) return
        if (kindOf(item) === 'image') setImagePrompt(item.prompt)
        else { stopReader(); setVideo(draftFromJob(item, forceMissing)) }
        focusDraft(kindOf(item)); setNotice(forceMissing || missingFrame(item) ? null : { key: 'reused' })
      }
      const useFrame = (item, position) => {
        if (!item.assetId || position === 'last' && !supportsLast) return
        stopReader()
        setVideo((d) => withSavedFrame(d, item, position))
        setNotice(null); focusDraft('video')
        // Staging an image is a draft change only. The user still has to select Generate video.
      }
      const clearFrame = () => {
        stopReader(); setVideo((d) => ({ ...d, reference: null, frameMode: 'first' })); setNotice({ key: 'textConfirmed', forMode: 'video' })
      }
      const begin = (type, id) => {
        if (lock.current) return false
        lock.current = { type, id }; setAction(lock.current); setNotice(null); return true
      }
      const end = () => { lock.current = null; if (alive.current) setAction(null) }
      const refresh = async () => { if (await jobs.refresh() && alive.current) setCheckHistory(false) }
      const start = async (item) => {
        if (blocked || (!item && composerBlocked) || (item && !canRetry(item))) return
        const kind = item ? kindOf(item) : mode
        const prompt = kind === 'video' ? video.prompt : imagePrompt
        if (!item && !prompt.trim()) { setNotice({ key: field.hint ? 'needMotion' : 'needPrompt', forMode: mode, style: 'error' }); promptInput.current?.focus(); return }
        const body = item ? { id: item.id } : kind === 'image' ? { kind: 'image', prompt: prompt.trim() } : videoRequest(video, size, seconds)
        if (!body || !begin(item ? 'retry' : 'generate', item?.id)) return
        const recordId = item?.id, submittedFrom = mediaVisit.current
        try {
          const job = await api(item ? '/retry' : '/generate', { body })
          if (!alive.current) return
          if (!validJob(job)) throw new Error('Invalid job response')
          jobs.accept(job); setTrackedId(job.id)
          if (item) setNotice({ key: 'newJob', jobKind: kind, recordId })
        } catch (cause) {
          if (!alive.current) return
          const gate = admissionNotice(cause, recordId)
          if (gate) {
            // Switching to 3D is read-only. A delayed refusal from the previous visit must not reappear on return.
            if (submittedFrom === mediaVisit.current) setNotice(gate)
            if (!gate.recovery) { onActivity(); await refresh() }
          } else if (cause.code === 'frame_missing' && kind === 'video') {
            if (item) {
              // Keep any existing draft intact. The row now explains how to reattach via Edit / reuse.
              jobs.accept({ ...item, frameAssetId: undefined, canRetry: false, retryCode: 'frame_missing', retryHint: message(cause) })
            } else {
              setVideo((d) => d.reference?.type === 'asset' && d.reference.id === body.imageAssetId ? { ...d, reference: { type: 'missing' } } : d)
            }
          } else if (!(cause instanceof ApiError) || cause.status >= 500) {
            // A dropped response does not prove failure. Reconcile; never automatically replay a POST.
            setCheckHistory(true); setNotice({ key: 'uncertain', detail: message(cause), style: 'warning', recordId }); await refresh()
          } else setNotice({ key: 'startError', detail: message(cause), style: 'error', recordId })
        } finally { end() }
      }
      const cancel = async (job) => {
        if (!begin('cancel', job.id)) return
        try {
          const result = await api('/cancel', { body: { id: job.id } })
          if (!alive.current) return
          if (validJob(result)) jobs.accept(result)
          if (!validJob(result) || ongoing(result)) setCancelRequested(job.id)
          else { setCancelRequested(null); setNotice({ key: statusOf(result) }) }
        } catch (cause) {
          if (alive.current) { setNotice({ key: 'cancelError', detail: message(cause), style: 'error' }); if (cause.status === 409) await refresh() }
        }
        finally { end() }
      }
      const openRemoval = (item, scope, trigger) => {
        if (lock.current || selection || !canRemove(item, scope)) return
        removalTrigger.current = { origin: trigger, destination: 'origin' }; setRemovalAnnouncement(''); setSelection({ item, scope })
      }
      const selectedNow = selection && jobs.items.find((row) => row.id === selection.item.id)
      const verifyStagedAssets = async (item, scope) => {
        // Deleting a link is not proof that its bytes are gone. Another job/library item may own the same image.
        const staged = new Set([video.reference?.type === 'asset' && video.reference.id, stagedThreeAssetId].filter(Boolean))
        const affected = new Set([item.assetId, scope === 'job' && item.frameAssetId].filter((id) => staged.has(id)))
        await Promise.all([...affected].map(async (id) => {
          const result = await fetch(assetUrl(id), { method: 'HEAD', cache: 'no-store' }).catch(() => null)
          if (!alive.current || ![404, 409].includes(result?.status)) return
          setVideo((draft) => draft.reference?.type === 'asset' && draft.reference.id === id ? { ...draft, reference: { type: 'missing' } } : draft)
          onAssetMissing(id)
        }))
      }
      const confirmRemoval = async (deleteOutput) => {
        if (lock.current || !selection || !sameRemovalTarget(selection.item, selectedNow) || !canRemove(selectedNow, selection.scope)) return
        const { item, scope } = selection, body = removalRequest(item, scope, deleteOutput)
        if (!body || !begin('delete', item.id)) return
        try {
          // An empty token also makes a statement: no physical output was present when the user confirmed.
          const result = await api('/delete', { body })
          if (!alive.current) return
          if (result?.deleted !== true || result.id !== item.id || result.scope !== scope) throw new Error('Unconfirmed deletion')
          if (scope === 'output' && !standalone(item)) {
            if (!validJob(result.job) || result.job.id !== item.id || result.job.hasOutput !== false || !result.job.outputDeleted) throw new Error('Unconfirmed job update')
            jobs.accept(result.job) // The row now explains that the output is gone and its inputs were kept.
            setTrackedId((id) => id === item.id ? '' : id)
          } else {
            jobs.forget(item.id); setTrackedId((id) => id === item.id ? '' : id)
            setInspected((id) => id === item.id ? undefined : id); setResultFocus((id) => id === item.id ? null : id)
          }
          if (removalTrigger.current) {
            const { announcement, retainedId } = confirmedRemoval(item, body)
            Object.assign(removalTrigger.current, { destination: 'history', retainedId }); setRemovalAnnouncement(announcement)
          }
          setRemovalIssue((issue) => issue?.id === item.id ? null : issue); setSelection(null)
        } catch (cause) {
          if (!alive.current) return
          const refused = cause instanceof ApiError && cause.status >= 400 && cause.status < 500
          if (removalTrigger.current) removalTrigger.current.destination = 'issue'
          setRemovalIssue({ id: item.id, key: refused ? 'deleteError' : 'deleteUnknown', detail: refused ? message(cause) : '', target: item.file || item.name || item.prompt?.slice(0, 80) || item.assetId || item.id }); setSelection(null)
        } finally {
          // A failed list refresh cannot turn a confirmed deletion into an unknown one. Never replay the POST.
          try { if (alive.current) await Promise.allSettled([refresh(), verifyStagedAssets(item, scope)]) } finally { end() }
        }
      }
      const openSettings = () => { if (settings && !oldHost) { setSettingsOpen(true); setNotice(null) } }
      const resultNotice = notice?.forMode && notice.forMode !== mode ? null
        : notice?.jobKind ? { ...notice, params: { kind: t(notice.jobKind) } } : notice
      const jumpToResult = () => { setInspected(tracked.id); setResultFocus(tracked.id) }
      return h('div', { className: 'tv-page' }, h('style', null, css), h('div', { className: 'tv-body' },
        oldHost ? h('div', { className: 'tv-row' }, note(t('olderHost'), 'warning'), button(t('reload'), { onClick: () => setSettingsRead((n) => n + 1) })) : null,
        !settings ? h('div', { className: 'tv-row' }, note(settingsError ? `${t('settingsError')} ${settingsError}` : t('loadingSettings'), settingsError ? 'error' : 'info'),
          settingsError ? button(t('reload'), { onClick: () => setSettingsRead((n) => n + 1) }) : null) : null,
        settingsOpen && settings && !oldHost ? h(SettingsForm, { t, saved: settings, onSaved: (next) => { setSettings(next); void refresh() }, onBack: () => focusDraft(mode) })
          : h('form', { className: 'tv-card', noValidate: true, onSubmit: (e) => { e.preventDefault(); void start() } },
            h('div', { className: 'tv-head' }, h('h2', null, t(mode === 'video' ? 'createVideo' : 'createImage')),
              settings && !oldHost ? button(t('settings'), { onClick: openSettings }) : null),
            h('div', { className: 'tv-tight' },
              h('label', { className: 'tv-field' }, t(field.label), h('textarea', { ref: promptInput, required: true, maxLength: 64000,
                value: mode === 'video' ? video.prompt : imagePrompt, placeholder: t(field.placeholder), 'aria-describedby': field.hint ? 'tv-motion-hint' : undefined,
                onChange: (e) => {
                  const v = e.currentTarget.value; if (mode === 'image') setImagePrompt(v); else setVideo((d) => ({ ...d, prompt: v }))
                  if (v.trim() && notice?.forMode === mode && ['needPrompt', 'needMotion'].includes(notice.key)) setNotice(null)
                } })),
              field.hint ? h('p', { id: 'tv-motion-hint', className: 'tv-meta' }, t(field.hint)) : null),
            mode === 'video' ? h(Reference, { t, video, update: setVideo, onPick: pick, onClear: clearFrame, onMakeImage: () => { setNotice(null); focusDraft('image') }, reading: readingFrame, supportsLast }) : null,
            mode === 'video' ? h('div', { className: 'tv-grid' }, h('label', { className: 'tv-field' }, t('size'),
              h('select', { value: size, disabled: !options.length, onChange: (e) => updateSize(e.currentTarget.value) },
                size && !options.includes(size) ? h('option', { value: size }, t('notOffered', { value: size })) : null,
                options.map((v) => h('option', { key: v, value: v }, v)))), h('label', { className: 'tv-field' }, t('duration'),
              h('select', { value: seconds, disabled: !durations.length, onChange: (e) => { const v = Number(e.currentTarget.value); setVideo((d) => ({ ...d, seconds: v })) } },
                settings && !validShape ? h('option', { value: seconds }, t('notOffered', { value: t('secondsValue', { n: seconds }) })) : null,
                durations.map((v) => h('option', { key: v, value: v }, t('secondsValue', { n: v })))))) : null,
            mode === 'video' && settings && !validShape ? note(t('shapeUnavailable'), 'warning') : null,
            settings && !oldHost && !settings.hasApiKey ? h('div', { className: 'tv-row tv-notice' }, h('span', null, t('needKey')), button(t('settings'), { onClick: openSettings })) : null,
            jobs.running.length || ownLease ? h('p', { className: 'tv-meta' }, t('waitActive')) : null,
            resultNotice && !resultNotice.recordId ? renderNotice(t, resultNotice, openThreeStatus) : null,
            h('div', { className: 'tv-row' }, button(t(action?.type === 'generate' ? 'starting' : mode === 'video' ? 'generateVideo' : 'generateImage'), {
              type: 'submit', className: 'tv-btn tv-primary', disabled: composerBlocked,
            }), checkHistory || (!jobs.read.ready && jobs.read.error) ? button(t('refreshHistory'), { disabled: jobs.read.busy, onClick: refresh }) : null)),
        settingsOpen && resultNotice && !resultNotice.recordId ? renderNotice(t, resultNotice, openThreeStatus) : null,
        h('div', { className: outcome ? `tv-head tv-notice ${statusOf(outcome) === 'failed' ? 'tv-errorbox' : ''}` : 'tv-sr' },
          h('span', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, tracked ? t('jobOutcome', { kind: t(kindOf(tracked)), status: t(statusOf(tracked)) }) : ''),
          outcome && !settingsOpen ? h('div', { className: 'tv-row' }, button(t('viewResult'), { onClick: jumpToResult }),
            outcome.outputDeleted ? h('span', { className: 'tv-meta' }, t('outputDeleted')) : outcome.hasOutput ? h(OutputActions, { t, item: outcome, onDelete: openRemoval, action }) : null) : null),
        jobs.running.length ? h('section', { className: 'tv-card', 'aria-labelledby': 'tv-active-heading' }, h('h2', { id: 'tv-active-heading' }, t('active')),
          jobs.pollError ? note(`${t('pendingStatus')} ${jobs.pollError}`, 'warning') : null,
          jobs.running.map((job) => h(ActiveJob, { key: job.id, job, t, action, onCancel: cancel, cancelRequested: cancelRequested === job.id }))) : null,
        h('span', { className: 'tv-sr', role: 'status', 'aria-atomic': true }, removalAnnouncement ? t(removalAnnouncement) : ''),
        visible && !settingsOpen ? h(History, { t, jobs, inspected, setInspected, focusId: resultFocus, onFocused: () => setResultFocus(null),
          headingRef: historyHeading, issueRef: issueText, removalIssue, onDismissIssue: () => { setRemovalIssue(null); historyHeading.current?.focus() },
          notice: resultNotice, onCheck3D: openThreeStatus, blocked, action, onRetry: start, onReuse: reuse, onFrame: useFrame, onThree,
          onDelete: openRemoval, onRefresh: refresh, onSettings: settings && !oldHost ? openSettings : undefined, supportsLast }) : null,
        visible && selection ? h(DeleteDialog, { key: `${selection.scope}:${selection.item.id}`, t, selection, current: selectedNow, busy: action?.type === 'delete',
          onCancel: () => { if (!lock.current) setSelection(null) }, onConfirm: confirmRemoval }) : null))
    }

    return { Panel, dictionary }
}
