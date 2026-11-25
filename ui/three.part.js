(React) => {
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    // -----------------------------------------------------------------------
    // text

    const TEXT = {
      en: {
        title: '3D model',
        subtitle: 'Build a textured GLB from one reference image.',
        staged: 'Reference from Studio added. Choose the quality, then select Generate complete model.',
        generatedImage: 'Generated image', chooseStudioImage: 'Generate a reference image',
        loadHelp: 'A compatible model is needed only to generate 3D. To use 3D, load one in TiinyOS and refresh. Images and videos do not need a 3D model.',
        serviceUnavailable: '3D service unavailable', serviceHelp: 'Studio cannot verify the 3D model state. Check the service in TiinyOS, then refresh.',
        urlHelp: 'Check the native 3D API address in 3D connection settings, then refresh.', keyHelp: 'Check the API key and the device address in 3D connection settings.',
        networkHelp: 'Check that the device is online and its 3D API address can be reached, then refresh.',
        recoveryNoId: 'Studio cannot identify the saved operation, so it cannot clear it here. Check the device in TiinyOS, keep the original 3D records, and recheck the status.',
        launchChoose: 'Select the 3D model to load', confirmLoad: 'Load this exact 3D model on your Tiiny?\n\n{model}\nCurrently running: {running}\n\nLoading a model can displace a running image or video model. Continue?',
        currentModels: 'Loaded models', pendingModels: 'Loading', busyModels: 'Serving requests', noneReported: 'None reported',
        recovery: 'Confirm device idle…', recoveryConfirm: 'Check TiinyOS first. Confirm there is no model loading and no active device task. Release the local Studio lock for {id}? This will not stop or change anything on the device.',
        recoveryLoad: 'The device did not confirm whether the previous 3D model load finished.',
        recoveryTask: 'The device did not confirm whether the previous 3D task ended.',
        recoveryUnknown: 'The result of a previous 3D operation is unconfirmed.', recoveryModel: 'Model: {model}.',
        recoverySteps: 'Recheck the status first. If the warning remains, check TiinyOS. Only confirm idle when no task is running and no model is loading.',
        reviewStatus: 'Recheck status', recoveryBusy: 'The device still reports an active task or model load. The local hold was not released.',
        recoveryChanged: 'The operation to confirm has changed. Recheck its status before taking any action.',
        recoveryCheckFailed: 'Could not confirm the device was idle. Check TiinyOS and recheck the status here.',
        managementActive: 'TiinyOS reports active requests or a pending model load. Wait for these operations to finish, then refresh.',
        managementUnknown: 'Studio cannot verify device activity. Check it in TiinyOS before loading a model.',
        recovering: 'Checking…', recovered: 'Your idle confirmation was recorded. Studio will check again before it starts new work.',
        nativeConnection: '3D uses the Tiiny native API. Its address and key are saved separately from the image & video connection.',
        keyLocation: 'Find the key in TiinyOS → Settings → API Key.', newKey: 'Enter a new key for the changed device origin.',
        unsavedSettings: 'Save or undo your 3D settings changes before starting. The device status uses the saved connection.',
        needsRefresh: 'Refresh device status before starting. Generation is available when a 3D service is ready.',
        previewKeyboard: 'Arrow keys rotate; + / − zoom; Home resets the view.',
        pollError: 'Run status is temporarily unavailable; the original job is being checked again.',
        stageBackground: 'Background',
        refresh: 'Refresh',
        settings: '3D connection settings',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        cancel: 'Cancel',
        close: 'Close',
        connected: 'Connected',
        connecting: 'Checking…',
        disconnected: 'Disconnected',
        noKey: 'API key missing',
        noModel: 'No 3D model running',
        unreachable: 'Device unreachable',
        badBaseUrl: 'Base URL wrong',
        checking: 'Checking the device…',
        model: 'Model',
        version: 'Service version',
        baseUrl: 'Base URL',
        apiKey: 'API key',
        apiKeySet: 'A key is stored — leave blank to keep it',
        outputDir: 'Output folder',
        settleDelay: 'Settle delay (s)',
        settleHint: 'Let the device release resources after texturing; 75 s by default, skippable',
        outputDirHint: 'The final painted.glb is copied here',
        image: 'Reference image',
        dropImage: 'Drop an image or click to choose',
        replaceImage: 'Replace',
        clearImage: 'Remove',
        imageHint: 'Use one clearly visible subject, a front or three-quarter view, soft lighting and a sharp image of 1024px or more. Use a plain or transparent background: this device has no background removal.',
        qualityLabel: 'Quality',
        qualityHint: 'Higher quality means a finer mesh and a longer run',
        presetFast: 'Fast',
        presetBalance: 'Balanced',
        presetQuality: 'High',
        presetFastHint: 'Mesh 192 — fastest, good for a first look',
        presetBalanceHint: 'Mesh 288 — more detail, slower generation. Enable Simplify if needed.',
        presetQualityHint: 'Mesh 384 — finest detail, longest generation. Enable Simplify if needed.',
        advancedShow: 'More options',
        advancedHide: 'Fewer options',
        simplifyHint: 'Turn on only when the mesh has too many faces; adds one stage',
        runPolish: 'Polish exported GLB',
        rename: 'Rename',
        renameHint: 'Rename the exported GLB on disk',
        deleteExport: 'Delete exported file', deleteProject: 'Delete project',
        deleteExportHelp: 'Permanently delete only this GLB from its output folder. The project, reference copy and stage files stay available.',
        deleteProjectHelp: 'Permanently delete this project’s history entry and workspace, including its private reference copy and stage files. The original reference and model weights are not affected.',
        alsoDeleteExport: 'Also delete the exported GLB from its output folder', keepExportHelp: 'By default, your exported GLB stays at this exact path:',
        stageFilesHelp: 'Workspace files are used by later stages. To remove them together, choose Delete project.',
        exportUnavailable: 'Exported file unavailable: {file}. The project’s stage files are separate.',
        exportDeleted: 'Exported file deleted. The project and its stage files were kept.',
        exportAlreadyGone: 'The exported file was already missing. Its project reference was cleared.',
        projectDeleted: 'Project deleted.', exportKept: 'Exported GLB kept at: {path}',
        referenceGone: 'The selected Studio image was deleted. Choose another reference to start a new run.',
        clearFailed: 'Delete failed projects', clearFailedHelp: 'Delete only finished failed and cancelled projects and their workspaces. All exported GLBs stay in their output folders. Active or unconfirmed tasks are kept.',
        clearFailedDone: 'Deleted {count} failed or cancelled projects. All exports were kept.',
        reveal: 'Show in Finder',
        revealHint: 'Show the exported GLB in Finder',
        launchModel: 'Start on device',
        launching: 'Loading model…',
        polishHint: 'Re-encode supported textures to sRGB and add missing vertex normals before export.',
        extraOptions: 'Model parameters',
        generation: 'Generation',
        precision: 'Output precision',
        inference: 'Inference quality',
        asset: 'Asset quality',
        seed: 'Seed',
        randomSeed: 'Randomize',
        runSimplify: 'Simplify mesh',
        extraParams: 'Model-reported parameters',
        extraHint: 'Only checked parameters are sent; unchecked ones use the device default',
        advanced: 'Advanced',
        generate: 'Generate complete model',
        generating: 'Generating…',
        cancelRun: 'Cancel',
        cancelling: 'Cancelling…',
        cancelPendingHint: 'Waiting for the device to stop. New runs stay disabled until cancellation is confirmed.',
        skipSettle: 'Skip wait',
        pipeline: 'Pipeline',
        stageShape: 'Shape',
        stageSimplify: 'Simplify',
        stageTexture: 'Texture',
        stageExport: 'Export',
        stageShapeHint: 'Untextured base mesh → shape.glb',
        stageSimplifyHint: 'Reduce faces → simplified.glb',
        stageTextureHint: 'Bake the material pack → hunyuan3d_material.zip',
        stageExportHint: 'Bake geometry and materials → painted.glb',
        stagePending: 'Pending',
        stageRunning: 'Running',
        stageCancelling: 'Cancelling',
        stageCompleted: 'Done',
        stageFailed: 'Failed',
        stageCancelled: 'Cancelled',
        stageSkipped: 'Skipped',
        stageWaiting: 'Needs reset',
        waitingAuto: 'Device reported "{detail}" — resuming automatically…',
        waitingManual: 'The device needs a reset ({detail}). Reset it, then press Resume; the task continues from its checkpoint.',
        runStage: 'Run this stage',
        rerunStage: 'Run again',
        needsInput: 'Missing input',
        settleWait: 'Waiting for the device',
        preview: 'Preview',
        noPreview: 'No model to preview yet',
        previewShape: 'Shape',
        previewSimplify: 'Simplified',
        previewExport: 'Workspace GLB',
        autoRotate: 'Auto-rotate',
        wireframe: 'Points',
        triangles: 'triangles',
        result: 'Artifacts',
        noArtifacts: 'No artifacts yet',
        download: 'Download',
        copyPath: 'Copy path',
        copied: 'Path copied',
        copyFailed: 'Could not copy the path. Select the path and copy it manually.',
        deleteFailed: 'Some files could not be deleted. The affected runs remain in history.',
        previewHint: 'Drag to rotate · Scroll to zoom · Double-click to reset',
        validImages: 'Choose a PNG, JPEG or WebP image of 16 MiB or less.',
        log: 'Log',
        history: 'Recent runs',
        noHistory: 'No projects in history.',
        totalTime: 'Total',
        error: 'Something went wrong',
        needImage: 'Choose a reference image first',
        needKeyFirst: 'Add your Tiiny API key in Settings first',
        keyNeeded: 'No Tiiny API key yet',
        addKey: 'Add key',
        badKey: 'Key rejected',
        connection: 'Connection & key',
        busyConflict: 'A run is already in progress',
        loadFailed: 'Could not read',
        openSettings: 'Connection',
        manualParams: 'Manual parameters',
        optional: 'optional',
        resume: 'Resume task',
      },

    }

    // -----------------------------------------------------------------------
    // styles

    const CSS = `
.t3d-delete-dialog{width:min(420px,90vw);max-height:82vh;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px;line-height:1.5}.t3d-delete-dialog p{white-space:pre-line}.t3d-delete-dialog code{display:block;overflow-wrap:anywhere;margin:6px 0}.t3d-delete-dialog .t3d-row{justify-content:flex-end;margin-top:16px}.t3d-delete-dialog::backdrop{background:#0006}.t3d-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

.t3d-page :is(button,input,select,canvas,[role=button]):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.t3d-page{container:tiiny3d / inline-size;max-width:100%;min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;min-height:0}
.t3d-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.t3d-head-mark{width:30px;height:30px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);flex:0 0 auto}
.t3d-head-text{display:flex;flex:1 1 220px;flex-direction:column;gap:1px;min-width:0}
.t3d-head-title{font-weight:600;font-size:17px;overflow-wrap:anywhere}
.t3d-head-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t3d-head-spacer{display:none}
.t3d-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:11.5px;font-family:inherit;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.t3d-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.t3d-dot.ok{background:var(--dsw-alias-state-success-primary)}
.t3d-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.t3d-dot.err{background:var(--dsw-alias-state-error-primary)}
.t3d-body{flex:1;min-height:0;display:flex;gap:14px;padding:14px 18px 18px;overflow:hidden}
.t3d-col{display:flex;flex-direction:column;gap:12px;min-height:0}
.t3d-col.left{width:356px;flex:0 0 356px;overflow-y:auto;padding-right:2px}
.t3d-col.right{flex:1;min-width:0;overflow-y:auto}
.t3d-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;flex:0 0 auto}
.t3d-card-head{display:flex;flex-wrap:wrap;min-width:0;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.t3d-card-body{padding:12px;display:flex;flex-direction:column;gap:10px}
.t3d-row{display:flex;align-items:center;gap:8px}
.t3d-row.wrap{flex-wrap:wrap}
.t3d-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.t3d-label{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.t3d-input,.t3d-select,.t3d-number{height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12.5px;padding:0 9px;outline:none;font-family:inherit;min-width:0}
.t3d-input:focus,.t3d-select:focus,.t3d-number:focus{border-color:var(--dsw-alias-brand-primary)}
.t3d-input::placeholder{color:var(--dsw-alias-label-secondary)}
.t3d-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.t3d-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.t3d-btn:disabled{opacity:.5;cursor:default}
.t3d-btn.primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:600}
.t3d-btn.primary:hover:not(:disabled){filter:brightness(1.05)}
.t3d-btn.ghost{background:transparent}
.t3d-btn.sm{height:24px;padding:0 8px;font-size:11.5px;border-radius:6px}
.t3d-btn.block{width:100%;justify-content:center;height:34px;font-size:13px}
.t3d-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);min-height:150px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;cursor:pointer;position:relative;overflow:hidden;padding:10px;text-align:center}
.t3d-drop:hover{border-color:var(--dsw-alias-brand-primary)}
.t3d-drop.over{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.t3d-drop img{max-width:100%;max-height:210px;border-radius:8px;display:block}
.t3d-drop-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.t3d-stage{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 10px;display:flex;flex-direction:column;gap:7px;background:var(--dsw-alias-bg-layer-1)}
.t3d-stage.active{border-color:var(--dsw-alias-brand-primary)}
.t3d-stage-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.t3d-idx{width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.t3d-stage-name{font-weight:600;font-size:12.5px;flex:1}
.t3d-stage-hint{font-size:11px;color:var(--dsw-alias-label-secondary);flex:1 0 100%;order:1;min-width:0;overflow-wrap:anywhere}
.t3d-badge{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.t3d-badge.running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.t3d-badge.completed{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.t3d-badge.failed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.t3d-badge.cancelled,.t3d-badge.cancelling,.t3d-badge.skipped,.t3d-badge.waiting{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.t3d-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.t3d-bar > i{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.t3d-stage-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.t3d-stage-foot .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t3d-preview-wrap{position:relative;border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);height:320px}
.t3d-canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.t3d-canvas:active{cursor:grabbing}
.t3d-preview-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:16px}
.t3d-preview-tools{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;align-items:center}
.t3d-preview-meta{position:absolute;right:10px;top:8px;font-size:10.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 6px}
.t3d-tabs{display:flex;gap:4px;flex-wrap:wrap}
.t3d-tab{height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer;font-family:inherit}
.t3d-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.t3d-files{display:flex;flex-direction:column;gap:6px}
.t3d-file{display:flex;align-items:center;gap:8px;font-size:11.5px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.t3d-file .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.t3d-file .size{color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.t3d-link{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:11.5px}
.t3d-error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:8px;padding:7px 9px;font-size:11.5px;word-break:break-word}
.t3d-warn{border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);border-radius:8px;padding:7px 9px;font-size:11.5px}
.t3d-model-state{gap:12px}
.t3d-model-state > .t3d-meta{margin:0;font-size:12px;line-height:1.5}
.t3d-recovery{display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;padding:12px;border-inline-start:3px solid var(--dsw-alias-state-warn-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.t3d-recovery > p{align-self:stretch;margin:0;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.t3d-recovery > .t3d-btn{box-sizing:border-box;height:auto;min-height:32px;max-width:100%;padding:5px 12px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}
.t3d-recovery > .t3d-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-secondary)}
@media (pointer:coarse){.t3d-recovery > .t3d-btn{min-height:44px}}
.t3d-cta{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border-radius:9px;border:1px dashed var(--dsw-alias-state-warn-primary);background:transparent;color:var(--dsw-alias-state-warn-primary);font-size:11.5px;font-family:inherit;cursor:pointer;text-align:left}
.t3d-cta:hover{background:var(--dsw-alias-bg-layer-2);border-style:solid}
.t3d-cta-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t3d-cta-action{font-weight:600;white-space:nowrap}
.t3d-chip.action{cursor:pointer;color:var(--dsw-alias-label-primary)}
.t3d-chip.action:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.t3d-chip.action .t3d-arrow{color:var(--dsw-alias-label-secondary);font-size:10px}
.t3d-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;max-height:150px;overflow:auto;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px 9px;display:flex;flex-direction:column;gap:1px}
.t3d-log .t{color:var(--dsw-alias-label-secondary);margin-right:6px}
.t3d-log .error{color:var(--dsw-alias-state-error-primary)}
.t3d-log .success{color:var(--dsw-alias-state-success-primary)}
.t3d-log .warn{color:var(--dsw-alias-state-warn-primary)}
.t3d-seg{display:flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.t3d-seg > button{flex:1;height:30px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer}
.t3d-seg > button + button{border-left:1px solid var(--dsw-alias-border-l1)}
.t3d-seg > button.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.t3d-seg > button:hover:not(.on){color:var(--dsw-alias-label-primary)}
.t3d-switch{display:inline-flex;min-width:0;overflow-wrap:anywhere;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none}
.t3d-switch input{flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;cursor:pointer}
.t3d-meta{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.t3d-kv{display:grid;grid-template-columns:82px 1fr;gap:4px 8px;font-size:11.5px}
.t3d-kv .k{color:var(--dsw-alias-label-secondary)}
.t3d-kv .v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t3d-history{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.t3d-history-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 8px;font-size:11px;padding:8px;border:1px solid transparent;border-radius:7px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.t3d-history-item:hover{border-color:var(--dsw-alias-border-l2)}
.t3d-history-item .when{grid-column:1;grid-row:2;color:var(--dsw-alias-label-secondary)}
.t3d-history-item .size{grid-column:2;grid-row:2;color:var(--dsw-alias-label-secondary)}
.t3d-history-item .what{grid-column:1 / -1;grid-row:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t3d-history-item button.what{font:inherit;font-weight:600;color:var(--dsw-alias-label-primary);text-align:left;border:0;padding:0;background:transparent;cursor:pointer}
.t3d-history-item button.what:disabled{cursor:default}
.t3d-history-actions{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:4px}
.t3d-artifact-path{flex:1 1 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t3d-preview-help{padding-top:6px;overflow-wrap:anywhere}
.t3d-btn:focus-visible,.t3d-tab:focus-visible,.t3d-history-item .what:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.t3d-warn,.t3d-meta{overflow-wrap:anywhere}
.t3d-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11.5px}
@media (max-width: 1080px){
  .t3d-body{flex-direction:column;overflow:auto}
  .t3d-col.left{width:auto;flex:0 0 auto;overflow:visible}
  .t3d-col.right{flex:0 0 auto;overflow:visible}
}
@container tiiny3d (max-width: 860px){
  .t3d-body{flex-direction:column;overflow:auto;padding:12px}
  .t3d-col.left,.t3d-col.right{width:auto;flex:0 0 auto;overflow:visible;padding-right:0}
  .t3d-head{padding:12px}
}
@container tiiny3d (max-width: 480px){
  .t3d-head-text{flex-basis:calc(100% - 50px)}
  .t3d-head .t3d-chip{height:auto;min-height:24px;white-space:normal;overflow-wrap:anywhere}
  .t3d-row{flex-wrap:wrap}
  .t3d-preview-wrap{height:280px}
  .t3d-preview-meta{max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
`

    // -----------------------------------------------------------------------
    // utils

    const fmtBytes = (n) => {
      const value = Number(n) || 0
      if (!value) return '—'
      if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
      if (value >= 1024) return `${Math.round(value / 1024)} KB`
      return `${value} B`
    }

    const fmtMs = (ms) => {
      const value = Number(ms) || 0
      if (value <= 0) return '—'
      if (value < 1000) return `${value} ms`
      if (value < 60000) return `${(value / 1000).toFixed(1)} s`
      return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`
    }

    const fmtClock = (ms) => {
      const d = new Date(Number(ms) || Date.now())
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    // Device/browser errors and historical logs may be localized. Only render Studio-owned
    // diagnostic copy; filenames, paths, model identifiers and other user data remain untouched.
    function diagnostic(cause, fallback = 'The operation could not be completed. Refresh and try again.') {
      const code = cause?.code, status = cause?.status
      const known = { unsafe_file:'Studio could not verify ownership or file identity. Unverified files were kept.', file_shared:'Another project references this file. The shared file was kept.', file_changed:'The selected exported file changed. Refresh and select it again.',
        run_active:'The project has an active or unconfirmed device task. Its files were kept.', device_busy:'The device is busy. Wait for the current operation to finish.', file_exists:'A file with that name already exists.', missing_run:'Project or saved export not found.', missing_export:'The exported file is missing.',
        studio_recovery_task:'A previous 3D task is unconfirmed. Recheck the 3D status.', studio_recovery_load:'A previous 3D model load is unconfirmed. Recheck the 3D status.', model_changed:'The running model or instance changed. Refresh before submitting.',
        invalid_name:'Choose a plain file name without path separators.', frame_missing:'The saved reference is unavailable. Choose a new reference.', no_pin:'The original model cannot be verified. Start a new project.' }
      if (known[code]) return known[code]
      if (status === 401 || status === 403) return 'Authorization failed. Check the saved native 3D API key.'
      if (status === 404) return 'This project, file, or service is no longer available.'
      if (typeof status === 'number') return `${fallback} (HTTP ${status})`
      return fallback
    }
    function logMessage(line) {
      const value = String(line?.text || ''), stage = /^(shape|simplify|texture|export): /.exec(value)?.[1] || 'Project'
      if (/^Saved the final model to /.test(value)) return value // the remaining value is the user's output path
      if (/^(Starting: (shape|simplify|texture|export)( -> (shape|simplify|texture|export))*|Rerunning stage: (shape|simplify|texture|export))$/.test(value)) return value
      if (/^(shape|simplify|texture|export): (Downloaded [\w.-]+ \([\d.]+ MB\)|Submitting task|Completed in [\d.]+ s|Cancelled|task [\w-]+|Resume requested|Cancel request acknowledged; waiting for stable terminal task status)$/.test(value)) return value
      return `${stage}: ${line?.level === 'error' ? 'An operation failed. Check the device and project status.' : line?.level === 'warn' ? 'A warning was recorded. Check the device and project status.' : line?.level === 'success' ? 'Operation completed.' : 'Progress update recorded.'}`
    }
    async function jsonFetch(url, init) {
      const options = init?.method === 'POST'
        ? { ...init, headers: { 'content-type': 'application/json', ...init.headers }, body: init.body ?? '{}' }
        : { ...init, cache: 'no-store' }
      const response = await fetch(url, options)
      const body = await response.json().catch(() => null)
      if (!response.ok || !body) throw Object.assign(new Error(body?.error || `HTTP ${response.status}`), { code: body?.code, status: response.status })
      return body
    }

    function historyFileUrl(entry) {
      return `/tiiny-video/3d/file?run=${encodeURIComponent(entry.id)}&name=${encodeURIComponent(entry.final.file)}&scope=export&v=${encodeURIComponent(entry.finishedAt || entry.createdAt || '')}`
    }

    function isHistoryPreviewFor(url, id) {
      return url.startsWith(`/tiiny-video/3d/file?run=${encodeURIComponent(id)}&`)
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('read failed'))
        reader.readAsDataURL(file)
      })
    }

    // -----------------------------------------------------------------------
    // GLB preview: parse the binary, then paint sorted flat-shaded triangles on
    // a 2D canvas. No external 3D library, so it works offline inside the shell.

    const COMPONENTS = {
      5120: [Int8Array, 1],
      5121: [Uint8Array, 1],
      5122: [Int16Array, 2],
      5123: [Uint16Array, 2],
      5125: [Uint32Array, 4],
      5126: [Float32Array, 4],
    }
    const TYPE_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

    function readAccessor(gltf, bin, index) {
      const accessor = gltf.accessors?.[index]
      if (!accessor || accessor.bufferView === undefined) return null
      const view = gltf.bufferViews?.[accessor.bufferView]
      if (!view) return null
      const component = COMPONENTS[accessor.componentType]
      if (!component) return null
      const [Ctor, compSize] = component
      const size = TYPE_SIZES[accessor.type] || 1
      const count = accessor.count || 0
      const base = (view.byteOffset || 0) + (accessor.byteOffset || 0)
      const stride = view.byteStride || size * compSize
      const total = count * size
      if (base >= bin.byteLength) return null
      if (stride === size * compSize) {
        try {
          const available = Math.floor((bin.byteLength - base) / compSize)
          const take = Math.min(total, available)
          const typed = new Ctor(bin.buffer, bin.byteOffset + base, take)
          return typed instanceof Float32Array ? typed : Float32Array.from(typed)
        } catch {
          /* misaligned buffer view: fall through to the DataView reader */
        }
      }
      const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
      const out = new Float32Array(total)
      const read = (offset) => {
        switch (accessor.componentType) {
          case 5121:
            return dv.getUint8(offset)
          case 5123:
            return dv.getUint16(offset, true)
          case 5125:
            return dv.getUint32(offset, true)
          case 5120:
            return dv.getInt8(offset)
          case 5122:
            return dv.getInt16(offset, true)
          default:
            return dv.getFloat32(offset, true)
        }
      }
      for (let i = 0; i < count; i += 1) {
        for (let c = 0; c < size; c += 1) {
          out[i * size + c] = read(base + i * stride + c * compSize)
        }
      }
      return out
    }

    function textureImageSource(gltf, bin, material) {
      const index = material?.pbrMetallicRoughness?.baseColorTexture?.index
      if (index === undefined) return null
      const texture = gltf.textures?.[index]
      const image = texture ? gltf.images?.[texture.source] : null
      if (!image) return null
      if (image.uri && !String(image.uri).startsWith('data:')) return null
      if (image.bufferView === undefined) {
        if (typeof image.uri === 'string' && image.uri.startsWith('data:')) return image.uri
        return null
      }
      const view = gltf.bufferViews?.[image.bufferView]
      if (!view) return null
      const start = view.byteOffset || 0
      const bytes = new Uint8Array(bin.buffer, bin.byteOffset + start, Math.min(view.byteLength || 0, bin.byteLength - start))
      const blob = new Blob([bytes], { type: image.mimeType || 'image/png' })
      return typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null
    }

    async function parseGlb(buffer, cap) {
      const dv = new DataView(buffer)
      if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a valid GLB file')
      let offset = 12
      let gltf = null
      let bin = null
      while (offset + 8 <= dv.byteLength) {
        const length = dv.getUint32(offset, true)
        const type = dv.getUint32(offset + 4, true)
        const start = offset + 8
        if (start + length > dv.byteLength) break
        if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)))
        else if (type === 0x004e4942) bin = new Uint8Array(buffer, start, length)
        offset = start + length
      }
      if (!gltf || !bin) throw new Error('The GLB is missing required data chunks')

      // A flat-colour approximation of the albedo texture keeps the preview
      // readable without sampling every texel.
      let palette = null
      try {
        const firstMaterial = (gltf.materials || []).find((material) => material?.pbrMetallicRoughness?.baseColorTexture)
        const source = firstMaterial ? textureImageSource(gltf, bin, firstMaterial) : null
        if (source) {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          await new Promise((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('texture decode failed'))
            image.src = source
          })
          const size = 1024
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(image, 0, 0, size, size)
          palette = { data: context.getImageData(0, 0, size, size).data, size }
          if (typeof source === 'string' && source.startsWith('blob:')) URL.revokeObjectURL(source)
        }
      } catch {
        palette = null
      }

      const triangles = []
      const colors = []
      const uvsSoup = []
      let minX = Infinity
      let minY = Infinity
      let minZ = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let maxZ = -Infinity
      const push = (ax, ay, az, bx, by, bz, cx, cy, cz, color, uvs) => {
        triangles.push(ax, ay, az, bx, by, bz, cx, cy, cz)
        colors.push(color[0], color[1], color[2])
        if (ax < minX) minX = ax
        if (bx < minX) minX = bx
        if (cx < minX) minX = cx
        if (ay < minY) minY = ay
        if (by < minY) minY = by
        if (cy < minY) minY = cy
        if (az < minZ) minZ = az
        if (bz < minZ) minZ = bz
        if (cz < minZ) minZ = cz
        if (ax > maxX) maxX = ax
        if (bx > maxX) maxX = bx
        if (cx > maxX) maxX = cx
        if (ay > maxY) maxY = ay
        if (by > maxY) maxY = by
        if (cy > maxY) maxY = cy
        if (az > maxZ) maxZ = az
        if (bz > maxZ) maxZ = bz
        if (cz > maxZ) maxZ = cz
        void uvs
      }

      const colorFromPalette = (uvs) => {
        if (!palette || !uvs) return null
        const u = ((uvs[0] + uvs[2] + uvs[4]) / 3) % 1
        const v = ((uvs[1] + uvs[3] + uvs[5]) / 3) % 1
        const x = Math.min(palette.size - 1, Math.max(0, Math.round(Math.abs(u) * (palette.size - 1))))
        const y = Math.min(palette.size - 1, Math.max(0, Math.round(Math.abs(v) * (palette.size - 1))))
        const at = (y * palette.size + x) * 4
        const data = palette.data
        if (data[at + 3] < 12) return null
        return [data[at] / 255, data[at + 1] / 255, data[at + 2] / 255]
      }

      for (const mesh of gltf.meshes || []) {
        for (const primitive of mesh.primitives || []) {
          const mode = primitive.mode === undefined ? 4 : primitive.mode
          if (mode !== 4) continue
          const position = readAccessor(gltf, bin, primitive.attributes?.POSITION)
          if (!position) continue
          const indices = primitive.indices !== undefined ? readAccessor(gltf, bin, primitive.indices) : null
          const uvs = primitive.attributes?.TEXCOORD_0 !== undefined ? readAccessor(gltf, bin, primitive.attributes.TEXCOORD_0) : null
          const material = (gltf.materials || [])[primitive.material] || null
          const factor = material?.pbrMetallicRoughness?.baseColorFactor
          const base = factor ? [factor[0] ?? 0.7, factor[1] ?? 0.7, factor[2] ?? 0.75] : [0.62, 0.69, 0.78]
          const count = indices ? indices.length : position.length / 3
          for (let i = 0; i + 2 < count; i += 3) {
            const ia = indices ? indices[i] : i
            const ib = indices ? indices[i + 1] : i + 1
            const ic = indices ? indices[i + 2] : i + 2
            const ax = position[ia * 3]
            const ay = position[ia * 3 + 1]
            const az = position[ia * 3 + 2]
            const bx = position[ib * 3]
            const by = position[ib * 3 + 1]
            const bz = position[ib * 3 + 2]
            const cx = position[ic * 3]
            const cy = position[ic * 3 + 1]
            const cz = position[ic * 3 + 2]
            if (![ax, ay, az, bx, by, bz, cx, cy, cz].every((value) => Number.isFinite(value))) continue
            let color = base
            if (uvs) {
              const sampled = colorFromPalette([uvs[ia * 2], uvs[ia * 2 + 1], uvs[ib * 2], uvs[ib * 2 + 1], uvs[ic * 2], uvs[ic * 2 + 1]])
              if (sampled) color = sampled
            }
            push(ax, ay, az, bx, by, bz, cx, cy, cz, color)
            if (uvs) uvsSoup.push(uvs[ia * 2], uvs[ia * 2 + 1], uvs[ib * 2], uvs[ib * 2 + 1], uvs[ic * 2], uvs[ic * 2 + 1])
            else uvsSoup.push(0, 0, 0, 0, 0, 0)
          }
        }
      }
      if (!colors.length) throw new Error('The model contains no renderable triangles')
      const texture = palette ? { data: palette.data, size: palette.size } : null

      const totalTriangles = Math.floor(triangles.length / 9)
      const limit = Math.max(2000, cap || 40000)
      const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
      let radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2
      if (!Number.isFinite(radius) || radius <= 0) radius = 1

      if (totalTriangles <= limit) {
        const positions = Float32Array.from(triangles)
        const triColors = Float32Array.from(colors)
        return { positions, colors: triColors, uvs: Float32Array.from(uvsSoup), texture, count: totalTriangles, total: totalTriangles, center, radius }
      }

      // A dense mesh must be *reduced*, not sampled: skipping triangles leaves
      // gaps between the survivors and the preview turns into confetti. Snap
      // vertices to a grid, keep one face per unique cell triple, and rebuild
      // from the snapped points — closed surface, just coarser. The grid is
      // retried until the face count lands near the budget.
      const build = (grid) => {
        const spanX = (maxX - minX) || 1e-6
        const spanY = (maxY - minY) || 1e-6
        const spanZ = (maxZ - minZ) || 1e-6
        const key = (x, y, z) => {
          const ix = Math.min(grid - 1, Math.max(0, Math.floor(((x - minX) / spanX) * grid)))
          const iy = Math.min(grid - 1, Math.max(0, Math.floor(((y - minY) / spanY) * grid)))
          const iz = Math.min(grid - 1, Math.max(0, Math.floor(((z - minZ) / spanZ) * grid)))
          return ix + iy * grid + iz * grid * grid
        }
        const cells = new Map()
        for (let i = 0; i < triangles.length; i += 3) {
          const k = key(triangles[i], triangles[i + 1], triangles[i + 2])
          const cell = cells.get(k)
          if (cell) {
            cell[0] += triangles[i]
            cell[1] += triangles[i + 1]
            cell[2] += triangles[i + 2]
            cell[3] += 1
          } else {
            cells.set(k, [triangles[i], triangles[i + 1], triangles[i + 2], 1])
          }
        }
        for (const [k, cell] of cells) cells.set(k, [cell[0] / cell[3], cell[1] / cell[3], cell[2] / cell[3]])
        const seen = new Set()
        const kept = []
        const keptColors = []
        const keptUvs = []
        for (let t = 0; t < totalTriangles; t += 1) {
          const b = t * 9
          const ka = key(triangles[b], triangles[b + 1], triangles[b + 2])
          const kb = key(triangles[b + 3], triangles[b + 4], triangles[b + 5])
          const kc = key(triangles[b + 6], triangles[b + 7], triangles[b + 8])
          if (ka === kb && kb === kc) continue
          // 32-bit order-independent hash: a rare collision only drops a preview
          // triangle whose snapped corners already coincide with another one.
          const id = (Math.imul(ka, 73856093) ^ Math.imul(kb, 19349663) ^ Math.imul(kc, 83492791)) >>> 0
          if (seen.has(id)) continue
          seen.add(id)
          const a = cells.get(ka)
          const bb = cells.get(kb)
          const c = cells.get(kc)
          kept.push(a[0], a[1], a[2], bb[0], bb[1], bb[2], c[0], c[1], c[2])
          keptColors.push(colors[t * 3], colors[t * 3 + 1], colors[t * 3 + 2])
          // positions are nine floats per face, UVs only six
          const ub = t * 6
          keptUvs.push(uvsSoup[ub], uvsSoup[ub + 1], uvsSoup[ub + 2], uvsSoup[ub + 3], uvsSoup[ub + 4], uvsSoup[ub + 5])
        }
        return { kept, keptColors, keptUvs }
      }

      // Face count grows with grid² on a surface; ~50 faces per cell² is a good
      // first guess for these meshes, and the retries correct for denser or
      // emptier ones.
      let grid = Math.max(8, Math.min(220, Math.round(Math.sqrt(limit / 50))))
      let result = build(grid)
      for (let pass = 0; pass < 3; pass += 1) {
        const count = result.kept.length / 9
        const ratio = count / limit
        if (ratio > 1.35 || ratio < 0.75) {
          grid = Math.max(8, Math.min(220, Math.round(grid * Math.sqrt(limit / count))))
          result = build(grid)
        } else {
          break
        }
      }
      const kept = result.kept
      const keptColors = result.keptColors
      const keptUvs = result.keptUvs
      const positions = Float32Array.from(kept)
      const triColors = Float32Array.from(keptColors)
      return {
        positions,
        colors: triColors,
        uvs: Float32Array.from(keptUvs),
        texture,
        count: positions.length / 9,
        total: totalTriangles,
        center,
        radius,
      }
    }

    // Keep at most two coarse/fine pairs; browsing history must not retain every
    // decoded model forever. Share the download while both detail levels load.
    const previewCache = new Map()
    const previewDownloads = new Map()

    async function loadModel(url, cap) {
      const key = `${url}#${cap}`
      if (previewCache.has(key)) {
        const cached = previewCache.get(key)
        previewCache.delete(key)
        previewCache.set(key, cached)
        return cached
      }
      let download = previewDownloads.get(url)
      if (!download) {
        download = fetch(url).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.arrayBuffer()
        })
        previewDownloads.set(url, download)
        const release = () => {
          if (previewDownloads.get(url) === download) previewDownloads.delete(url)
        }
        download.then(release, release)
      }
      const pending = download.then(async (buffer) => {
        const model = await parseGlb(buffer, cap)
        model.bytes = buffer.byteLength
        return model
      })
      previewCache.set(key, pending)
      while (previewCache.size > 4) previewCache.delete(previewCache.keys().next().value)
      pending.catch(() => {
        if (previewCache.get(key) === pending) previewCache.delete(key)
      })
      return pending
    }

    const LIGHT = (() => {
      const v = [0.42, -0.55, 0.72]
      const len = Math.hypot(v[0], v[1], v[2])
      return [v[0] / len, v[1] / len, v[2] / len]
    })()

    /**
     * Still-frame renderer: a z-buffered, textured rasteriser. The flat painter
     * below only shades one colour per triangle, which at 90k sub-pixel faces
     * looks like confetti; sampling the real texture per pixel is what makes the
     * panel show the exported model rather than an impression of it.
     */
    function rasterize(model, view, width, height) {
      const out = new Uint8ClampedArray(width * height * 4)
      const depth = new Float32Array(width * height)
      depth.fill(1e30)
      for (let i = 0; i < out.length; i += 4) {
        out[i] = 250
        out[i + 1] = 250
        out[i + 2] = 250
        out[i + 3] = 255
      }
      const positions = model.positions
      const uvs = model.uvs
      const data = model.texture.data
      const size = model.texture.size
      const cyw = Math.cos(view.yaw)
      const syw = Math.sin(view.yaw)
      const cpt = Math.cos(view.pitch)
      const spt = Math.sin(view.pitch)
      const scale = (Math.min(width, height) / 2 / model.radius) * 0.86 * view.zoom
      const ox = width / 2
      const oy = height / 2
      const cx = model.center[0]
      const cy = model.center[1]
      const cz = model.center[2]
      const light = [0.36, 0.48, 0.8]
      const px = new Float32Array(3)
      const py = new Float32Array(3)
      const pz = new Float32Array(3)
      const vx = new Float32Array(3)
      const vy = new Float32Array(3)
      const vz = new Float32Array(3)
      const count = model.count
      for (let t = 0; t < count; t += 1) {
        const base = t * 9
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (let v = 0; v < 3; v += 1) {
          const x = positions[base + v * 3] - cx
          const y = positions[base + v * 3 + 1] - cy
          const z = positions[base + v * 3 + 2] - cz
          const rx = x * cyw + z * syw
          const rz = -x * syw + z * cyw
          const ry = y * cpt - rz * spt
          const rz2 = y * spt + rz * cpt
          vx[v] = rx
          vy[v] = ry
          vz[v] = rz2
          px[v] = ox + rx * scale
          py[v] = oy - ry * scale
          pz[v] = rz2
          if (px[v] < minX) minX = px[v]
          if (px[v] > maxX) maxX = px[v]
          if (py[v] < minY) minY = py[v]
          if (py[v] > maxY) maxY = py[v]
        }
        const x0 = Math.max(0, Math.floor(minX))
        const x1 = Math.min(width - 1, Math.ceil(maxX))
        const y0 = Math.max(0, Math.floor(minY))
        const y1 = Math.min(height - 1, Math.ceil(maxY))
        if (x1 < x0 || y1 < y0) continue
        const det = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
        // det is twice the projected area in pixels; below a fraction of a pixel
        // the barycentrics are pure noise and would smear the atlas everywhere.
        if (Math.abs(det) < 0.4) continue
        const e1x = vx[1] - vx[0]
        const e1y = vy[1] - vy[0]
        const e1z = vz[1] - vz[0]
        const e2x = vx[2] - vx[0]
        const e2y = vy[2] - vy[0]
        const e2z = vz[2] - vz[0]
        let nx = e1y * e2z - e1z * e2y
        let ny = e1z * e2x - e1x * e2z
        let nz = e1x * e2y - e1y * e2x
        const nl = Math.hypot(nx, ny, nz) || 1
        const shade = 0.74 + 0.26 * Math.abs((nx / nl) * light[0] + (ny / nl) * light[1] + (nz / nl) * light[2])
        // positions carry nine floats per face, UVs only six
        const ub = t * 6
        const u0 = uvs[ub]
        const v0 = uvs[ub + 1]
        const u1 = uvs[ub + 2]
        const v1 = uvs[ub + 3]
        const u2 = uvs[ub + 4]
        const v2 = uvs[ub + 5]
        for (let pyi = y0; pyi <= y1; pyi += 1) {
          const row = pyi * width
          for (let pxi = x0; pxi <= x1; pxi += 1) {
            const w0 = ((py[1] - py[2]) * (pxi - px[2]) + (px[2] - px[1]) * (pyi - py[2])) / det
            if (w0 < 0) continue
            const w1 = ((py[2] - py[0]) * (pxi - px[2]) + (px[0] - px[2]) * (pyi - py[2])) / det
            if (w1 < 0) continue
            const w2 = 1 - w0 - w1
            if (w2 < 0) continue
            const z = w0 * pz[0] + w1 * pz[1] + w2 * pz[2]
            const index = row + pxi
            if (z >= depth[index]) continue
            depth[index] = z
            const u = w0 * u0 + w1 * u1 + w2 * u2
            const v = w0 * v0 + w1 * v1 + w2 * v2
            let tu = Math.floor((u - Math.floor(u)) * size)
            let tv = Math.floor((v - Math.floor(v)) * size)
            if (tu < 0) tu = 0
            else if (tu >= size) tu = size - 1
            if (tv < 0) tv = 0
            else if (tv >= size) tv = size - 1
            const ti = (tv * size + tu) * 4
            const o = index * 4
            out[o] = data[ti] * shade
            out[o + 1] = data[ti + 1] * shade
            out[o + 2] = data[ti + 2] * shade
            out[o + 3] = 255
          }
        }
      }
      return out
    }

    function paintTextured(context, canvas, model, view, width, height) {
      // Render above canvas resolution: at ~1 px per face the UV interpolation
      // turns into noise, at ~4 px it looks like the real material. While the
      // camera moves the cheaper 1× pass keeps dragging at full frame rate.
      const factor = view.fast ? 0.62 : Math.max(1, Math.min(2, 1200 / Math.max(width, height)))
      const rw = Math.max(64, Math.round(width * factor))
      const rh = Math.max(64, Math.round(height * factor))
      if (!model.buffer || model.buffer.width !== rw || model.buffer.height !== rh) {
        const buffer = document.createElement('canvas')
        buffer.width = rw
        buffer.height = rh
        const bufferContext = buffer.getContext('2d')
        if (!bufferContext) return false
        model.buffer = { width: rw, height: rh, canvas: buffer, context: bufferContext, image: bufferContext.createImageData(rw, rh) }
      }
      model.buffer.image.data.set(rasterize(model, view, rw, rh))
      model.buffer.context.putImageData(model.buffer.image, 0, 0)
      context.clearRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.drawImage(model.buffer.canvas, 0, 0, width, height)
      return true
    }

    function paint(canvas, model, view) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(80, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(80, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, width, height)
      if (!model) return
      // Both still and moving frames use the texture; only point clouds and
      // untextured meshes fall back to the painter below.
      if (model.texture && model.uvs && !view.points) {
        try {
          if (paintTextured(context, canvas, model, view, width, height)) return
        } catch (failure) {
          // Never leave a blank canvas because of the pretty path: drop back to
          // the flat painter for this model and say why once.
          model.texture = null
          if (typeof console !== 'undefined') console.warn('textured preview failed, using flat shading:', failure)
        }
      }

      const cy = Math.cos(view.yaw)
      const sy = Math.sin(view.yaw)
      const cp = Math.cos(view.pitch)
      const sp = Math.sin(view.pitch)
      const scale = (Math.min(width, height) / 2 / model.radius) * 0.78 * view.zoom
      const ox = width / 2
      const oy = height / 2
      const positions = model.positions
      const colors = model.colors
      const count = model.count
      const cx = model.center[0]
      const cyy = model.center[1]
      const cz = model.center[2]

      // Scratch buffers live on the cached model so a frame allocates nothing.
      if (!model.scratch || model.scratch.count !== count) {
        model.scratch = {
          count,
          projected: new Float32Array(count * 9),
          camera: new Float32Array(count * 9),
          depth: new Float32Array(count),
          shade: new Float32Array(count),
          order: Array.from({ length: count }, (_, index) => index),
        }
      }
      const { projected, camera, depth, shade, order } = model.scratch
      for (let t = 0; t < count; t += 1) {
        const base = t * 9
        let sumZ = 0
        for (let v = 0; v < 3; v += 1) {
          const x = positions[base + v * 3] - cx
          const y = positions[base + v * 3 + 1] - cyy
          const z = positions[base + v * 3 + 2] - cz
          const rx = x * cy + z * sy
          const rz = -x * sy + z * cy
          const ry = y * cp - rz * sp
          const rz2 = y * sp + rz * cp
          camera[base + v * 3] = rx
          camera[base + v * 3 + 1] = ry
          camera[base + v * 3 + 2] = rz2
          projected[base + v * 3] = ox + rx * scale
          projected[base + v * 3 + 1] = oy - ry * scale
          projected[base + v * 3 + 2] = rz2
          sumZ += rz2
        }
        depth[t] = sumZ / 3
        // Camera-space face normal, double sided shading.
        const ux = camera[base + 3] - camera[base]
        const uy = camera[base + 4] - camera[base + 1]
        const uz = camera[base + 5] - camera[base + 2]
        const vx = camera[base + 6] - camera[base]
        const vy = camera[base + 7] - camera[base + 1]
        const vz = camera[base + 8] - camera[base + 2]
        const nxv = uy * vz - uz * vy
        const nyv = uz * vx - ux * vz
        const nzv = ux * vy - uy * vx
        const nlen = Math.hypot(nxv, nyv, nzv) || 1
        const dot = Math.abs((nxv / nlen) * LIGHT[0] + (nyv / nlen) * LIGHT[1] + (nzv / nlen) * LIGHT[2])
        shade[t] = 0.34 + 0.66 * dot
      }

      // Far (+Z) first, near (-Z) last, matching the textured z-buffer.
      // Otherwise grey meshes and points appear to turn inside-out on drag.
      order.sort((a, b) => depth[b] - depth[a])

      const points = view.points
      if (points) {
        for (const t of order) {
          const base = t * 9
          const r = Math.round(colors[t * 3] * 255 * shade[t])
          const g = Math.round(colors[t * 3 + 1] * 255 * shade[t])
          const b = Math.round(colors[t * 3 + 2] * 255 * shade[t])
          context.fillStyle = `rgb(${r},${g},${b})`
          context.fillRect(projected[base] - 0.7, projected[base + 1] - 0.7, 1.6, 1.6)
        }
        return
      }

      for (const t of order) {
        const base = t * 9
        const r = Math.round(colors[t * 3] * 255 * shade[t])
        const g = Math.round(colors[t * 3 + 1] * 255 * shade[t])
        const b = Math.round(colors[t * 3 + 2] * 255 * shade[t])
        const style = `rgb(${r},${g},${b})`
        context.fillStyle = style
        context.strokeStyle = style
        context.lineWidth = 0.7
        context.beginPath()
        context.moveTo(projected[base], projected[base + 1])
        context.lineTo(projected[base + 3], projected[base + 4])
        context.lineTo(projected[base + 6], projected[base + 7])
        context.closePath()
        context.fill()
        context.stroke()
      }
    }

    function GlbPreview({ url, t }) {
      const canvasRef = useRef(null)
      const wrapRef = useRef(null)
      const view = useRef({ yaw: Math.PI - 0.45, pitch: 0.24, zoom: 1, dragging: false, lastX: 0, lastY: 0, points: false })
      const modelRef = useRef(null)
      const coarseRef = useRef(null)
      const rafRef = useRef(0)
      const tRef = useRef(t)
      tRef.current = t
      const fineTimer = useRef(0)
      const pending = useRef({ fine: true, frame: 0 })
      const [auto, setAuto] = useState(false)
      const [points, setPoints] = useState(false)
      const [state, setState] = useState({ loading: false, error: '', info: '' })

      // Two levels of detail: the full mesh while the view is still, a lighter
      // one while it moves. Subsampling is what left the old preview full of
      // holes, so the still frame always paints every triangle.
      const render = useCallback((useFine = true) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const model = (useFine ? modelRef.current : coarseRef.current) || modelRef.current
        view.current.fast = !useFine
        try {
          paint(canvas, model, view.current)
        } catch (failure) {
          setState((current) => ({ ...current, error: diagnostic(failure) }))
        }
      }, [])

      /**
       * One paint per animation frame. A trackpad fires pointermove far faster
       * than a 40k-face raster can keep up, and painting per event is what made
       * dragging feel heavy: every move queued a full render.
       */
      const requestPaint = useCallback(
        (fine) => {
          pending.current.fine = fine
          if (pending.current.frame) return
          pending.current.frame = window.requestAnimationFrame(() => {
            pending.current.frame = 0
            render(pending.current.fine)
          })
        },
        [render],
      )

      useEffect(() => {
        let alive = true
        const dispose = () => {
          alive = false
          view.current.dragging = false
          window.clearTimeout(fineTimer.current)
          if (pending.current.frame) window.cancelAnimationFrame(pending.current.frame)
          pending.current.frame = 0
        }
        // Never draw the previous asset's coarse mesh while a new URL loads.
        modelRef.current = null
        coarseRef.current = null
        view.current.dragging = false
        render()
        if (!url) {
          setState({ loading: false, error: '', info: '' })
          return dispose
        }
        setState({ loading: true, error: '', info: '' })
        loadModel(url, 15000)
          .then((model) => {
            if (alive) coarseRef.current = model
          })
          .catch(() => {})
        loadModel(url, 40000)
          .then((model) => {
            if (!alive) return
            modelRef.current = model
            coarseRef.current = coarseRef.current || model
            view.current.yaw = Math.PI - 0.45
            view.current.pitch = 0.24
            view.current.zoom = 1
            setState({ loading: false, error: '', info: `${model.count === model.total ? model.total : `${model.count}/${model.total}`} ${tRef.current('triangles')} · ${fmtBytes(model.bytes)}` })
            render()
          })
          .catch((failure) => {
            if (!alive) return
            modelRef.current = null
            setState({ loading: false, error: diagnostic(failure), info: '' })
            render()
          })
        return dispose
      }, [url, render])

      useEffect(() => {
        view.current.points = points
        render()
      }, [points, render])

      // Only spin the RAF loop while auto-rotation runs; dragging paints directly.
      useEffect(() => {
        if (!auto) {
          cancelAnimationFrame(rafRef.current)
          return undefined
        }
        const step = () => {
          // auto-rotation must not fight the pointer
          if (!view.current.dragging) {
            view.current.yaw += 0.007
            render(false)
          }
          rafRef.current = requestAnimationFrame(step)
        }
        rafRef.current = requestAnimationFrame(step)
        return () => cancelAnimationFrame(rafRef.current)
      }, [auto, render])

      useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => render())
        observer.observe(wrap)
        return () => observer.disconnect()
      }, [render])

      const onPointerDown = (event) => {
        view.current.dragging = true
        view.current.lastX = event.clientX
        view.current.lastY = event.clientY
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      const onPointerMove = (event) => {
        if (!view.current.dragging) return
        const dx = event.clientX - view.current.lastX
        const dy = event.clientY - view.current.lastY
        view.current.lastX = event.clientX
        view.current.lastY = event.clientY
        // The textured z-buffer treats negative camera Z as the visible side.
        // Rotate that surface WITH the pointer: both angles need the opposite
        // sign to the old painter, which used to treat positive Z as near.
        view.current.yaw -= dx * 0.008
        view.current.pitch = Math.max(-1.45, Math.min(1.45, view.current.pitch - dy * 0.006))
        requestPaint(false)
      }
      const onPointerUp = () => {
        if (!view.current.dragging) return
        view.current.dragging = false
        if (pending.current.frame) {
          window.cancelAnimationFrame(pending.current.frame)
          pending.current.frame = 0
        }
        render(true)
      }
      // A wheel burst must not queue one full-quality raster per notch: paint the
      // cheap pass immediately and the fine one once the wheel settles.
      const renderFineSoon = useCallback(() => {
        window.clearTimeout(fineTimer.current)
        requestPaint(false)
        fineTimer.current = window.setTimeout(() => render(true), 180)
      }, [render, requestPaint])

      /** Double-click restores the front three-quarter view after free orbiting. */
      const onDoubleClick = () => {
        view.current.yaw = Math.PI - 0.45
        view.current.pitch = 0.24
        view.current.zoom = 1
        render(true)
      }

      const onKeyDown = (e) => {
        const v = view.current
        if (e.key === 'ArrowLeft') v.yaw -= .15
        else if (e.key === 'ArrowRight') v.yaw += .15
        else if (e.key === 'ArrowUp') v.pitch = Math.min(Math.PI / 2, v.pitch + .15)
        else if (e.key === 'ArrowDown') v.pitch = Math.max(-Math.PI / 2, v.pitch - .15)
        else if (e.key === '+' || e.key === '=') v.zoom = Math.min(3, v.zoom * 1.15)
        else if (e.key === '-') v.zoom = Math.max(.35, v.zoom / 1.15)
        else if (e.key === 'Home') { e.preventDefault(); onDoubleClick(); return }
        else return
        e.preventDefault(); requestPaint(true)
      }

      const onWheel = (event) => {
        event.preventDefault()
        view.current.zoom = Math.max(0.35, Math.min(3, view.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)))
        renderFineSoon()
      }

      return h(
        'div',
        { className: 't3d-preview-wrap', ref: wrapRef },
        h('canvas', {
          ref: canvasRef,
          className: 't3d-canvas', tabIndex: 0, onKeyDown, 'aria-label': `${t('preview')} · ${t('previewKeyboard')}`,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onDoubleClick,
          onWheel,
        }),
        state.error || state.loading || !url
          ? h(
              'div',
              { className: 't3d-preview-empty' },
              state.loading ? t('checking') : state.error ? `${t('loadFailed')}: ${state.error}` : t('noPreview'),
            )
          : null,
        state.info ? h('div', { className: 't3d-preview-meta' }, state.info) : null,
        h(
          'div',
          { className: 't3d-preview-tools' },
          h(
            'button',
            { type: 'button', 'aria-pressed': auto, className: `t3d-btn sm ${auto ? '' : 'ghost'}`, onClick: () => setAuto((value) => !value) },
            t('autoRotate'),
          ),
          h(
            'button',
            { type: 'button', 'aria-pressed': points, className: `t3d-btn sm ${points ? '' : 'ghost'}`, onClick: () => setPoints((value) => !value) },
            t('wireframe'),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // panel

    function ActionDialog({ choice, busy, error, t, cancel, submit }) {
      const dialog = useRef(null), [removeExport, setRemoveExport] = useState(false)
      const project = choice.action === 'project', bulk = choice.action === 'failed'
      const title = choice.title || t(project ? 'deleteProject' : bulk ? 'clearFailed' : 'deleteExport')
      const confirmLabel = project && removeExport ? 'Delete project and exported file' : title
      useEffect(() => {
        const node = dialog.current, opener = document.activeElement
        node.showModal(); node.querySelector('[data-safe-cancel]')?.focus()
        return () => { if (node.open) node.close(); if (opener?.isConnected) opener.focus(); else document.querySelector('#t3d-history-heading')?.focus() }
      }, [])
      return h('dialog', { ref: dialog, className: 't3d-delete-dialog', 'aria-labelledby':'t3d-delete-title', 'aria-describedby':'t3d-delete-detail', onCancel:e => { e.preventDefault(); if (!busy) cancel() } },
        h('h3', { id:'t3d-delete-title' }, title),
        h('p', { id:'t3d-delete-detail' }, choice.detail || t(project ? 'deleteProjectHelp' : bulk ? 'clearFailedHelp' : 'deleteExportHelp')),
        choice.id && !choice.detached ? h('div', { className:'t3d-meta' }, `Project: ${choice.id}`) : null,
        bulk ? h('div',null,h('strong',null,`${choice.projects.length} reviewed project${choice.projects.length === 1 ? '' : 's'}`),h('ul',null,...choice.projects.map(p=>h('li',{key:p.id},`${p.id} · ${p.status}`)))) : null,
        choice.path ? h('p', null, project ? removeExport ? 'The following GLB will also be permanently deleted:' : t('keepExportHelp') : null, h('code', null, choice.path)) : null,
        project && choice.path ? h('label', { className:'t3d-switch' }, h('input', {type:'checkbox', checked:removeExport, disabled:busy, onChange:e=>setRemoveExport(e.target.checked)}), t('alsoDeleteExport')) : null,
        error ? h('p', { className:'t3d-error', role:'alert' }, error) : null,
        h('div', {className:'t3d-row'}, h('button', {type:'button', className:'t3d-btn sm', 'data-safe-cancel':'', disabled:busy, onClick:cancel}, t('cancel')),
          h('button', {type:'button', className:'t3d-btn sm ghost', disabled:busy, onClick:()=>submit(removeExport)}, confirmLabel)))
    }

    function Panel({ t, visible, reference, unavailableAsset, leased, ownLease, onActivity, onMakeImage }) {
        const [settings, setSettings] = useState(null)
        const [status, setStatus] = useState(null)
        const [statusBusy, setStatusBusy] = useState(false)
        const [run, setRun] = useState(null)
        const [image, setImage] = useState(null)
        const [busy, setBusy] = useState(false)
        const [cancelBusy, setCancelBusy] = useState(false)
        const [error, setError] = useState('')
        const [showSettings, setShowSettings] = useState(false)
        const [settingsNonce, setSettingsNonce] = useState(0)
        const keyInputRef = useRef(null)
        const [launching, setLaunching] = useState(false)
        const [launchChoice, setLaunchChoice] = useState('')
        const [noticeKey, setNoticeKey] = useState('')
        const [jobError, setJobError] = useState('')
        const [reading, setReading] = useState(false)
        const visibleRef = useRef(visible)
        visibleRef.current = visible
        const statusRequest = useRef(null)
        const writeLock = useRef(false)
        const uploadVersion = useRef(0)
        const aliveRef = useRef(false)
        useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; uploadVersion.current++; statusRequest.current?.abort() } }, [])
        useEffect(() => {
          if (!reference) return
          uploadVersion.current++
          setReading(false); setImage({ assetId: reference.assetId, name: reference.name }); setNoticeKey('staged'); setError('')
        }, [reference])
        useEffect(() => {
          if (unavailableAsset?.id && image?.assetId === unavailableAsset.id) { setImage(null); setNoticeKey('referenceGone') }
        }, [unavailableAsset, image?.assetId])
        const [showAdvanced, setShowAdvanced] = useState(false)
        const [showLog, setShowLog] = useState(false)
        const [showHistory, setShowHistory] = useState(false)
        const [draft, setDraft] = useState({ baseUrl: '', apiKey: '', outputDir: '', settleDelay: 75 })
        const [options, setOptions] = useState({ simplify: false, settleDelay: 75, polish: true })
        const [preset, setPreset] = useState('quality')
        const [seed, setSeed] = useState(42)
        const [extras, setExtras] = useState({})
        const [extrasEnabled, setExtrasEnabled] = useState({})
        const [previewStage, setPreviewStage] = useState('shape')
        const [history, setHistory] = useState([])
        const [historyPreview, setHistoryPreview] = useState('')
        const [historyBusy, setHistoryBusy] = useState('')
        const [historyError, setHistoryError] = useState('')
        const [copiedPath, setCopiedPath] = useState('')
        const [copyError, setCopyError] = useState('')
        const [historyEditing, setHistoryEditing] = useState('')
        const [historyDraft, setHistoryDraft] = useState('')
        const [choice, setChoice] = useState(null), [savedGlbs, setSavedGlbs] = useState([])
        const [deleteNotice, setDeleteNotice] = useState(''), [selectedId, setSelectedId] = useState('')
        useEffect(() => { if (!visible) setDeleteNotice('') }, [visible])
        const libraryVersion = useRef(0), mutationVersion = useRef(0), deletionLock = useRef(false)
        const openChoice = value => { setHistoryError(''); setDeleteNotice(''); setChoice(value) }
        const refreshLibrary = useCallback(async () => {
          const request = ++libraryVersion.current, value = await jsonFetch('/tiiny-video/3d/history')
          if (aliveRef.current && request === libraryVersion.current) { setHistory(value.runs || []); setSavedGlbs(value.exports || []) }
        }, [])
        const [over, setOver] = useState(false)
        const leftColRef = useRef(null)
        const fileInput = useRef(null)
        const logRef = useRef(null)

        const loadStatus = useCallback(async () => {
          if (!visibleRef.current || document.hidden) return null
          statusRequest.current?.abort()
          const request = new AbortController()
          statusRequest.current = request
          setStatusBusy(true)
          let result = null
          try {
            const next = await jsonFetch('/tiiny-video/3d/status', { signal: request.signal })
            if (request.signal.aborted || !visibleRef.current) return null
            result = next
            setStatus(next)
            if (next?.paramGroups?.length) {
              const init = {}
              const on = {}
              for (const group of next.paramGroups) {
                for (const param of group.params) {
                  const key = `${group.stage}:${param.name}`
                  if (param.default !== null && param.default !== undefined && param.default !== '') init[key] = param.default
                  on[key] = false
                }
              }
              setExtras((current) => ({ ...init, ...current }))
              setExtrasEnabled((current) => ({ ...on, ...current }))
            }
          } catch (failure) {
            if (request.signal.aborted || !visibleRef.current) return null
            result = { ok: false, reachable: false, error: diagnostic(failure) }
            setStatus(result)
          } finally {
            if (!request.signal.aborted && aliveRef.current) setStatusBusy(false)
          }
          return result
        }, [])

        useEffect(() => {
          if (!visible) return
          const probe = () => { if (document.hidden) statusRequest.current?.abort(); else void loadStatus() }
          probe(); document.addEventListener('visibilitychange', probe)
          return () => { statusRequest.current?.abort(); document.removeEventListener('visibilitychange', probe) }
        }, [visible, loadStatus])

        const candidates = Array.isArray(status?.launchCandidates) ? status.launchCandidates : status?.launchable?.id ? [status.launchable] : []
        const candidate = candidates.find((m) => m.id === launchChoice && m.status === 'downloaded') || (status?.launchable?.id ? candidates.find((m) => m.id === status.launchable.id) : null)
        const runningModels = Array.isArray(status?.runningModels) ? status.runningModels : []
        const settingsDirty = Boolean(settings && (draft.apiKey.trim() || draft.baseUrl.trim() !== settings.baseUrl || draft.outputDir.trim() !== settings.outputDir || Number(draft.settleDelay) !== Number(settings.settleDelay)))
        // An unreadable legacy record can block work without supplying an ID that is safe to acknowledge.
        const needsRecovery = Boolean(status?.recoveryKind || status?.recoveryId || status?.recoveryMessage)
        const writeBlocked = Boolean(leased || needsRecovery || settingsDirty || statusBusy)
        const allowLaunch = Boolean(!writeBlocked && candidate?.status === 'downloaded' && status?.canLaunch === true && run?.status !== 'running' && !statusBusy && !launching)
        // This is the only model-changing POST. The dialog identifies the exact ID and the currently running set.
        const launchDeviceModel = async confirmed => {
          if (!allowLaunch || writeLock.current) return
          const modelId = candidate.id, expectedRunningModels = [...runningModels]
          if (confirmed?.action !== 'load') return openChoice({action:'load', modelId, running:JSON.stringify(expectedRunningModels), title:t('launchModel'), detail:t('confirmLoad', {model:modelId, running:expectedRunningModels.join(' · ') || t('noneReported')})})
          if (confirmed.modelId !== modelId || confirmed.running !== JSON.stringify(expectedRunningModels)) { setError('The displayed models changed. Recheck the status before loading.'); return }
          writeLock.current = true; setLaunching(true); setError(''); setNoticeKey('')
          try {
            await jsonFetch('/tiiny-video/3d/launch-model', { method: 'POST', body: JSON.stringify({ confirm: true, modelId, expectedRunningModels }) })
          } catch (cause) { if (aliveRef.current) setError(diagnostic(cause)) }
          finally {
            writeLock.current = false
            if (aliveRef.current) { setLaunching(false); onActivity(); if (visibleRef.current) void loadStatus() }
          }
        }
        // A model can be loaded and idle. Only work in flight, not the list of loaded models, prevents this acknowledgement.
        const canAcknowledge = Boolean(status?.recoveryId && !statusBusy && !busy && !launching && !settingsDirty && !leased && !status.pendingModels?.length && !status.busyModels?.length)
        const acknowledgeIdle = async confirmed => {
          const id = status?.recoveryId
          if (!canAcknowledge || writeLock.current) return
          if (confirmed?.action !== 'ack') return openChoice({action:'ack', recoveryId:id, title:'Confirm device idle', detail:t('recoveryConfirm', {id})})
          if (confirmed.recoveryId !== id) { setNoticeKey('recoveryChanged'); return }
          writeLock.current = true; setBusy(true); setError(''); setNoticeKey('')
          try {
            await jsonFetch('/tiiny-video/3d/acknowledge-idle', { method: 'POST', body: JSON.stringify({ id, confirm: true }) })
            if (aliveRef.current) setNoticeKey('recovered')
          } catch (cause) {
            if (aliveRef.current) setNoticeKey(cause.code === 'device_busy' ? 'recoveryBusy' : cause.code === 'not_recoverable' ? 'recoveryChanged' : 'recoveryCheckFailed')
          }
          finally { writeLock.current = false; if (aliveRef.current) { setBusy(false); onActivity(); if (visibleRef.current) void loadStatus() } }
        }

        /** The only way into the key/base-url form: open it, and optionally focus the key field. */
        const openSettings = useCallback((focusKey = false) => {
          setShowSettings(true)
          if (focusKey) setSettingsNonce((value) => value + 1)
        }, [])

        useEffect(() => {
          if (!visible || !settingsNonce || !showSettings) return
          const column = leftColRef.current
          if (column) column.scrollTop = 0
          const node = keyInputRef.current
          if (!node) return
          node.focus()
          if (typeof node.select === 'function') node.select()
        }, [settingsNonce, showSettings, visible])

        useEffect(() => {
          let alive = true
          jsonFetch('/tiiny-video/3d/settings')
            .then((value) => {
              if (!alive || !value) return
              setSettings(value)
              setDraft({ baseUrl: value.baseUrl, apiKey: '', outputDir: value.outputDir, settleDelay: value.settleDelay })
              setOptions({ simplify: value.simplify === true, settleDelay: value.settleDelay ?? 75, polish: value.polish !== false })
              // Nothing works before a key exists, so start where the key is.
              if (!value.hasApiKey) {
                setShowSettings(true)
                setSettingsNonce(1)
              }
            })
            .catch((cause) => { if (alive) setError(diagnostic(cause)) })
          refreshLibrary().catch(cause => { if (alive) setHistoryError(diagnostic(cause)) })
          return () => {
            alive = false
          }
        }, [])

        // The Host polls Tiiny. Query only the local run snapshot, sequentially; switching workspaces
        // does not cancel a run or start a second pipeline. A later visit also discovers remote-agent jobs.
        useEffect(() => {
          if (!visible && !ownLease && run?.status !== 'running') return
          const request = new AbortController()
          let timer
          const tick = async () => {
            let pollAgain = run?.status === 'running'
            try {
              const revision = mutationVersion.current
              const currentId = !ownLease && selectedId
              const value = await jsonFetch('/tiiny-video/3d/run' + (currentId ? '?id=' + encodeURIComponent(currentId) : ''), { signal: request.signal })
              if (revision !== mutationVersion.current || deletionLock.current) { if (!request.signal.aborted) timer = setTimeout(tick, 1500); return }
              if (request.signal.aborted) return
              setJobError(''); pollAgain = value.run?.status === 'running' || (Boolean(ownLease) && !value.run)
              if (run?.status === 'running' && !pollAgain) {
                onActivity()
                await refreshLibrary()
              }
              if (!request.signal.aborted && revision === mutationVersion.current) setRun(value.run || null)
              if (!pollAgain && visible && !document.hidden) await refreshLibrary()
            } catch (cause) { pollAgain = true; if (!request.signal.aborted) setJobError(diagnostic(cause)) }
            if (!request.signal.aborted && (pollAgain || visible)) timer = setTimeout(tick, pollAgain ? 1500 : 6000)
          }
          void tick()
          return () => { request.abort(); clearTimeout(timer) }
        }, [visible, run?.status, run?.id, ownLease, onActivity, selectedId, refreshLibrary])

        useEffect(() => {
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
        }, [run?.log?.length])

        const apiKeyReady = Boolean(settings?.hasApiKey)
        const running = run?.status === 'running'
        const cancelling = running && Boolean(run?.cancelRequested)
        const stageRecords = run?.stages || {}

        const pickFile = useCallback(
          async (file) => {
            if (!file) return
            const version = ++uploadVersion.current
            setReading(false); setNoticeKey('')
            if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || !file.size || file.size > 16 * 1024 * 1024) {
              setError(t('validImages'))
              return
            }
            try {
              setReading(true)
              const dataUrl = await readFileAsDataUrl(file)
              if (!aliveRef.current || uploadVersion.current !== version) return
              setImage({ dataUrl, name: file.name, bytes: file.size })
              setError('')
            } catch (failure) {
              if (aliveRef.current && uploadVersion.current === version) setError(diagnostic(failure))
            } finally { if (aliveRef.current && uploadVersion.current === version) setReading(false) }
          },
          [t],
        )

        const saveSettings = useCallback(async () => {
          if (writeLock.current) return
          writeLock.current = true; setBusy(true); setError(''); setNoticeKey('')
          try {
            if (new URL(draft.baseUrl).origin !== new URL(settings.baseUrl).origin && !draft.apiKey.trim()) throw new Error(t('newKey'))
            const payload = {
              baseUrl: draft.baseUrl,
              outputDir: draft.outputDir,
              settleDelay: Number(draft.settleDelay) || 0,
              simplify: options.simplify, polish: options.polish,
            }
            if (draft.apiKey) payload.apiKey = draft.apiKey
            const value = await jsonFetch('/tiiny-video/3d/settings', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            setSettings(value)
            setDraft((current) => ({ ...current, apiKey: '', baseUrl: value.baseUrl, outputDir: value.outputDir, settleDelay: value.settleDelay }))
            setError('')
            setStatus(null); setLaunchChoice(''); setNoticeKey('saved')
            const probe = await loadStatus()
            if (probe?.ok || probe?.authorized) setShowSettings(false)
          } catch (failure) {
            setError(diagnostic(failure))
          } finally {
            writeLock.current = false; setBusy(false)
          }
        }, [draft, options, loadStatus, settings, t])

        const startRun = useCallback(async () => {
          if (writeLock.current || launching || running || reading || writeBlocked || !status?.ok || !visible) return
          if (!image) {
            setError(t('needImage'))
            return
          }
          if (!apiKeyReady) {
            setError(t('needKeyFirst'))
            openSettings(true)
            return
          }
          writeLock.current = true; setError(''); setNoticeKey(''); setBusy(true)
          try {
            const extrasPayload = {}
            for (const group of status?.paramGroups || []) {
              for (const param of group.params) {
                const key = `${group.stage}:${param.name}`
                if (!extrasEnabled[key]) continue
                const value = extras[key]
                if (value === undefined || value === '' || value === null) continue
                const typed = param.type === 'number' ? Number(value) : param.type === 'boolean' ? Boolean(value) : value
                extrasPayload[group.stage] = { ...(extrasPayload[group.stage] || {}), [param.name]: typed }
              }
            }
            const body = await jsonFetch('/tiiny-video/3d/generate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...(image.assetId ? { imageAssetId: image.assetId } : { imageDataUrl: image.dataUrl }),
                imageName: image.name, expectedModel: status.model, modelInstance: status.modelInstance || undefined,
                preset,
                seed: Math.max(0, Math.round(Number(seed) || 0)),
                options: { simplify: options.simplify, settleDelay: Number(options.settleDelay) || 0, polish: options.polish },
                extras: extrasPayload,
              }),
            })
            setRun(body.run)
            setSelectedId(''); setPreviewStage('shape')
            setHistoryPreview('')
          } catch (failure) {
            setError(diagnostic(failure))
          } finally { writeLock.current = false; setBusy(false); onActivity() }
        }, [image, apiKeyReady, preset, seed, extras, extrasEnabled, options, status, t, openSettings, running, launching, writeBlocked, reading, visible, onActivity])

        const cancelRun = useCallback(async () => {
          setCancelBusy(true)
          try {
            const body = await jsonFetch('/tiiny-video/3d/cancel', { method: 'POST' })
            if (body?.run) setRun(body.run)
          } catch (failure) {
            setError(diagnostic(failure))
          } finally {
            setCancelBusy(false)
          }
        }, [])

        const renameRun = useCallback(
          async (id) => {
            const name = historyDraft.trim()
            if (!name || historyBusy) return
            setHistoryBusy(id)
            setHistoryError('')
            try {
              const body = await jsonFetch('/tiiny-video/3d/rename-run', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id, name }),
              })
              setHistory((current) => current.map((item) => (item.id === id ? { ...item, final: body.final } : item)))
              setRun((current) => current?.id === id ? { ...current, final: body.final } : current)
              setHistoryPreview((current) => isHistoryPreviewFor(current, id) ? historyFileUrl({ id, final: body.final }) : current)
              setHistoryEditing('')
            } catch (failure) {
              setHistoryError(diagnostic(failure))
            } finally {
              setHistoryBusy('')
            }
          },
          [historyDraft, historyBusy],
        )

        const chooseDelete = (action, entry, detached = false) => {
          if (historyBusy || leased) return
          const file = detached ? entry : entry.final || entry.unavailableExport
          openChoice({action, id:entry.id, path:file?.path, file:file?.file, detached,
            ...(action === 'forget' ? {title:'Forget listing', detail:'Remove this entry from Saved GLB exports. Nothing is deleted from disk.'} : {}),
            ...(detached && action === 'export' ? {detail:'Permanently delete this saved GLB from its output folder and remove its listing.'} : {}),
          })
        }
        const submitChoice = async removeExport => {
          if (!choice || deletionLock.current) return
          if (choice.action === 'load' || choice.action === 'ack') {
            setChoice(null); return choice.action === 'load' ? launchDeviceModel(choice) : acknowledgeIdle(choice)
          }
          const {action,id,file,detached} = choice, project = action === 'project', bulk = action === 'failed'
          deletionLock.current = true; libraryVersion.current++; mutationVersion.current++
          setHistoryBusy(id || 'failed'); setHistoryError('')
          try {
            const args = bulk ? {projects:choice.projects} : {id, ...(file && (!project || removeExport) ? {expectedFile:file} : {}),
              ...(project ? {removeExport:removeExport === true} : {}), ...(action === 'forget' ? {forgetOnly:true} : {})}
            const result = await jsonFetch('/tiiny-video/3d/' + (bulk ? 'delete-failed' : project ? 'delete-project' : 'delete-export'), {method:'POST', body:JSON.stringify(args)})
            if (!aliveRef.current) return
            const removed = new Set(bulk ? result.removedIds || [] : [id])
            if (project || bulk) {
              setHistory(rows=>rows.filter(row=>!removed.has(row.id)))
              setRun(current=>current && removed.has(current.id) ? null : current)
              setSelectedId(current=>removed.has(current) ? '' : current)
            } else if (detached) setSavedGlbs(rows=>rows.filter(row=>row.id!==id))
            else {
              const cleared = current=>current?.id === id ? {...current, final:null, finalUrl:'', unavailableExport:null, deletedExport:result.deletedExport} : current
              setHistory(rows=>rows.map(cleared)); setRun(cleared)
            }
            if ([...removed].some(key=>isHistoryPreviewFor(historyPreview,key))) { setHistoryPreview(''); setPreviewStage('') }
            setHistoryEditing(''); setCopiedPath(''); setCopyError(''); setChoice(null)
            if (visibleRef.current) setDeleteNotice(bulk ? t('clearFailedDone',{count:result.removed}) : project ? t('projectDeleted') + (result.keptExport ? ' ' + t('exportKept',{path:result.keptExport}) : '')
              : action === 'forget' ? 'Listing removed. No file was deleted.' : detached ? (result.missing ? 'The file was already missing. Its listing was removed.' : 'Saved GLB deleted.') : t(result.missing ? 'exportAlreadyGone' : 'exportDeleted'))
            if (result.failures?.length) setHistoryError(t('deleteFailed'))
            await refreshLibrary()
          } catch (cause) { if (aliveRef.current) setHistoryError(diagnostic(cause)) }
          finally { deletionLock.current = false; mutationVersion.current++; if (aliveRef.current) setHistoryBusy('') }
        }

        const revealRun = useCallback(async (id) => {
          if (historyBusy) return
          setHistoryBusy(id)
          setHistoryError('')
          try {
            await jsonFetch('/tiiny-video/3d/reveal-run', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id }),
            })
          } catch (failure) {
            setHistoryError(diagnostic(failure))
          } finally {
            setHistoryBusy('')
          }
        }, [historyBusy])

        const copyFinalPath = useCallback(async () => {
          const path = run?.final?.path
          if (!path) return
          setCopyError('')
          setCopiedPath('')
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
            await navigator.clipboard.writeText(path)
            setCopiedPath(path)
          } catch {
            setCopyError(t('copyFailed'))
          }
        }, [run?.final?.path, t])

        const skipSettle = useCallback(async () => {
          try {
            const body = await jsonFetch('/tiiny-video/3d/skip-settle', { method: 'POST' })
            if (body?.run) setRun(body.run)
          } catch {
            /* the wait may have already finished */
          }
        }, [])

        const resumeRun = useCallback(async () => {
          try {
            const body = await jsonFetch('/tiiny-video/3d/resume', { method: 'POST' })
            if (body?.run) setRun(body.run)
          } catch (failure) {
            setError(diagnostic(failure))
          }
        }, [])

        const runStage = useCallback(
          async (stage) => {
            if (writeLock.current || writeBlocked || running || !status?.ok) return
            writeLock.current = true; setNoticeKey(''); setError('')
            setBusy(true)
            try {
              const body = await jsonFetch('/tiiny-video/3d/stage', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ stage, runId: run?.id, expectedModel: status.model, modelInstance: status.modelInstance || undefined }),
              })
              if (body?.run) {
                setRun(body.run)
                setHistoryPreview('')
                setPreviewStage(stage === 'texture'
                  ? (body.run.stages?.simplify?.status === 'completed' ? 'simplify' : 'shape')
                  : stage)
              }
            } catch (failure) {
              setError(diagnostic(failure))
            } finally { writeLock.current = false; setBusy(false); onActivity() }
          },
          [run?.id, writeBlocked, running, status, onActivity],
        )

        const simplifyInPlan = Boolean(run?.plan?.includes('simplify') || options.simplify)
        const visibleStages = ['shape', 'simplify', 'texture', 'export']

        const stageLabel = (stage) => t(`stage${stage.charAt(0).toUpperCase()}${stage.slice(1)}`)
        const stageHint = (stage) => t(`stage${stage.charAt(0).toUpperCase()}${stage.slice(1)}Hint`)
        const statusLabel = (value) => {
          const map = {
            pending: 'stagePending',
            running: 'stageRunning',
            cancelling: 'stageCancelling',
            completed: 'stageCompleted',
            failed: 'stageFailed',
            cancelled: 'stageCancelled',
            skipped: 'stageSkipped',
            waiting: 'stageWaiting',
          }
          return t(map[value] || 'stagePending')
        }

        const prereqOk = (stage) => {
          if (!run) return false
          if (stage === 'shape') return Boolean(image || run.image?.file)
          if (stage === 'simplify') return stageRecords.shape?.status === 'completed'
          if (stage === 'texture') return stageRecords.shape?.status === 'completed'
          if (stage === 'export') return stageRecords.texture?.status === 'completed'
          return false
        }

        const previewOptions = useMemo(() => {
          const list = []
          if (run?.stages?.shape?.url) list.push(['shape', t('previewShape')])
          if (run?.stages?.simplify?.url) list.push(['simplify', t('previewSimplify')])
          if (run?.stages?.export?.url) list.push(['export', t('previewExport')])
          if (run?.final?.file) list.push(['file', 'Exported GLB'])
          return list
        }, [run, t])

        const previewUrl = useMemo(() => {
          if (historyPreview) {
            const valid = history.some(r=>r.final && historyFileUrl(r) === historyPreview) || savedGlbs.some(r=>r.state === 'available' && historyFileUrl({id:r.id,final:r}) === historyPreview)
            return valid ? historyPreview : ''
          }
          if (previewStage === 'file') return run?.final ? run.finalUrl || historyFileUrl(run) : ''
          const record = run?.stages?.[previewStage]
          return record?.url || ''
        }, [historyPreview, history, savedGlbs, run, previewStage])
        const previewProject = historyPreview ? history.find(row=>row.final && historyFileUrl(row) === historyPreview) : null
        const previewStandalone = historyPreview ? savedGlbs.find(row=>row.state === 'available' && historyFileUrl({id:row.id,final:row}) === historyPreview) : null
        const deleteButton = (action, entry, label, standalone=false) => h('button', {type:'button', className:'t3d-btn sm ghost', disabled:Boolean(leased || historyBusy || entry?.status==='running'), onClick:()=>chooseDelete(action, entry, standalone)}, label)

        const connection = (() => {
          if (!status) return { tone: '', label: t('connecting'), help: t('checking'), fixable: true }
          const problem = status.problem || ''
          if (problem === 'no-key' || settings?.hasApiKey === false) return { tone: 'warn', label: t('noKey'), help: t('needKeyFirst'), fixable: true }
          if (problem === 'service-unavailable') return { tone: 'warn', label: t('serviceUnavailable'), help: t('serviceHelp'), fixable: false }
          if (status.reachable === false || problem === 'unreachable') return { tone: 'err', label: t('unreachable'), help: t('networkHelp'), fixable: true }
          if (status.ok) return { tone: 'ok', label: t('connected'), help: '', fixable: false }
          if (problem === 'base-url') return { tone: 'err', label: t('badBaseUrl'), help: t('urlHelp'), fixable: true }
          if (problem === 'bad-key') return { tone: 'warn', label: t('badKey'), help: t('keyHelp'), fixable: true }
          return problem === 'no-model' ? { tone: 'warn', label: t('noModel'), help: t('loadHelp'), fixable: false }
            : { tone: 'warn', label: t('disconnected'), help: t('serviceHelp'), fixable: true }
        })()

        const PRESET_PARAMS = new Set(['output_precision', 'inference_quality', 'asset_quality', 'seed', 'texture_size', 'supersample', 'target_faces'])
        const extrasGroups = (status?.paramGroups || [])
          .map((group) => ({ ...group, params: group.params.filter((param) => !PRESET_PARAMS.has(param.name)) }))
          .filter((group) => group.params.length)

        const recoveryKey = status?.recoveryKind === 'load' ? 'recoveryLoad' : status?.recoveryKind === 'task' ? 'recoveryTask' : 'recoveryUnknown'
        const reportedWork = Boolean(status?.pendingModels?.length || status?.busyModels?.length)
        const modelControls = status && (status.error || needsRecovery || status.managementWarning) ? h('div', { className: 't3d-card' },
          h('div', { className: 't3d-card-body t3d-model-state' },
            status.error ? h('div', { className: 't3d-warn' }, h('strong', null, connection.label),
              h('div', null, connection.help)) : null,
            status.problem === 'no-model' || needsRecovery ? h('div', { className: 't3d-meta' },
              [[t('currentModels'), runningModels], [t('pendingModels'), status.pendingModels], [t('busyModels'), status.busyModels]]
                .filter(([, ids], i) => i === 0 || ids?.length).map(([label, ids]) => h('div', { key: label }, `${label}: ${ids?.join(' · ') || t('noneReported')}`))) : null,
            status.managementWarning ? h('p', { className: 't3d-meta' }, t(reportedWork ? 'managementActive' : 'managementUnknown')) : null,
            status.problem === 'no-model' && candidates.length ? h('div', { className: 't3d-field' }, h('label', { className: 't3d-label' }, t('launchChoose'),
              h('select', { className: 't3d-select', value: candidate?.id || '', disabled: launching || busy, onChange: (e) => setLaunchChoice(e.currentTarget.value) },
                !candidate || candidates.length > 1 ? h('option', { value: '' }, t('launchChoose')) : null, candidates.map((m) => h('option', { key: m.id, value: m.id, disabled: m.status !== 'downloaded' }, m.status === 'downloaded' ? m.id : `${m.id} · ${{running:'Running',loading:'Loading',pending:'Pending',loaded:'Loaded',downloading:'Downloading'}[m.status] || 'Not available'}`)))),
              h('button', { type: 'button', className: 't3d-btn ghost', disabled: !allowLaunch || busy, onClick: launchDeviceModel }, t(launching ? 'launching' : 'launchModel'))) : null,
            needsRecovery ? h('div', { className: 't3d-recovery' },
              h('p', { role: 'status' }, [t(recoveryKey), status.recoveryModel ? t('recoveryModel', { model: status.recoveryModel }) : '', t(status.recoveryId ? 'recoverySteps' : 'recoveryNoId')].filter(Boolean).join(' ')),
              h('button', { type: 'button', className: 't3d-btn', disabled: statusBusy || busy || launching, onClick: loadStatus }, t(statusBusy ? 'recovering' : 'reviewStatus')),
              status.recoveryId ? h('button', { type: 'button', className: 't3d-btn', disabled: !canAcknowledge, onClick: acknowledgeIdle }, t('recovery')) : null) : null)) : null

        const renderSettings = () =>
          showSettings
            ? h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head' },
                  t('connection'),
                  h('span', { style: { flex: 1 } }),
                  h('button', { type: 'button', className: 't3d-btn sm ghost', onClick: () => setShowSettings(false) }, t('close')),
                ),
                h(
                  'div',
                  { className: 't3d-card-body' },
                  h(
                    'div',
                    { className: 't3d-field' },
                    h('p', { className: 't3d-meta' }, t('nativeConnection')),
                    h('label', { className: 't3d-label', htmlFor: 't3d-base' }, t('baseUrl')),
                    h('input', {
                      className: 't3d-input',
                      id: 't3d-base', type: 'url', value: draft.baseUrl, disabled: busy || launching, required: true,
                      placeholder: 'http://api.tiiny/v1',
                      onChange: (event) => setDraft({ ...draft, baseUrl: event.target.value }),
                    }),
                  ),
                  h(
                    'div',
                    { className: 't3d-field' },
                    h('label', { className: 't3d-label', htmlFor: 't3d-key' }, t('apiKey')),
                    h('input', {
                      ref: keyInputRef,
                      className: 't3d-input',
                      type: 'password',
                      autoComplete: 'off',
                      id: 't3d-key', disabled: busy || launching, value: draft.apiKey,
                      placeholder: t('apiKey'),
                      onChange: (event) => setDraft({ ...draft, apiKey: event.target.value }),
                    }),
                    h('div', { className: 't3d-meta' }, settings?.hasApiKey ? t('apiKeySet') : t('keyLocation')),
                  ),
                  h(
                    'div',
                    { className: 't3d-field' },
                    h('label', { className: 't3d-label', htmlFor: 't3d-folder' }, t('outputDir')),
                    h('input', {
                      className: 't3d-input',
                      id: 't3d-folder', disabled: busy || launching, value: draft.outputDir,
                      onChange: (event) => setDraft({ ...draft, outputDir: event.target.value }),
                    }),
                    h('div', { className: 't3d-meta' }, t('outputDirHint')),
                  ),
                  h(
                    'div',
                    { className: 't3d-field' },
                    h('div', { className: 't3d-label' }, t('settleDelay')),
                    h('input', {
                      className: 't3d-number',
                      type: 'number',
                      min: 0,
                      max: 300,
                      'aria-label': t('settleDelay'), disabled: busy || launching, value: draft.settleDelay,
                      onChange: (event) => setDraft({ ...draft, settleDelay: Number(event.target.value) })},
                    ),
                    h('div', { className: 't3d-meta' }, t('settleHint')),
                  ),
                  h(
                    'div',
                    { className: 't3d-row' },
                    h('button', { type: 'button', className: 't3d-btn primary', disabled: busy, onClick: saveSettings }, busy ? t('saving') : t('save')),
                    h('button', { type: 'button', className: 't3d-btn ghost', onClick: () => loadStatus() }, t('refresh')),
                  ),
                ),
              )
            : null

        const renderStageRow = (stage, index) => {
          const record = stageRecords[stage]
          const optional = stage === 'simplify'
          const included = !run ? (stage === 'simplify' ? options.simplify : true) : run.plan?.includes(stage)
          const state = record?.cancelPending ? 'cancelling' : record?.waiting ? 'waiting' : record?.status || (included === false ? 'skipped' : 'pending')
          const live = state === 'running' || state === 'waiting' || state === 'cancelling'
          const progress = state === 'completed' ? 100 : live ? Math.max(3, Number(record?.progress) || 0) : 0
          return h(
            'div',
            { className: `t3d-stage ${live ? 'active' : ''}`, key: stage },
            h(
              'div',
              { className: 't3d-stage-top' },
              h('div', { className: 't3d-idx' }, String(index + 1)),
              h('div', { className: 't3d-stage-name', style: included === false ? { opacity: 0.55 } : undefined }, stageLabel(stage)),
              optional ? h('span', { className: 't3d-badge' }, t('optional')) : null,
              h('div', { className: 't3d-stage-hint' }, stageHint(stage)),
              h('span', { className: `t3d-badge ${state}` }, statusLabel(state)),
            ),
            h('div', { className: 't3d-bar' }, h('i', { style: { width: `${progress}%` } })),
            h(
              'div',
              { className: 't3d-stage-foot' },
              h(
                'span',
                { className: 'grow', title: record?.file || (record?.cancelError || record?.deviceError || record?.error ? 'The device reported a stage problem.' : '') },
                record?.cancelError ? 'Cancellation is unconfirmed.' : record?.file ? `${record.file} · ${fmtBytes(record.bytes)}` : record?.deviceError || record?.error ? 'The device reported a stage problem.' : '',
              ),
              record?.ms ? h('span', null, fmtMs(record.ms)) : null,
              run
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 't3d-btn sm ghost',
                      disabled: writeBlocked || launching || running || busy || !status?.ok || !prereqOk(stage),
                      title: prereqOk(stage) ? '' : t('needsInput'),
                      onClick: () => runStage(stage),
                    },
                    record?.status === 'completed' ? t('rerunStage') : t('runStage'),
                  )
                : null,
            ),
          )
        }

        const renderHistoryEntry = (entry) => {
          const editing = historyEditing === entry.id
          const locked = Boolean(leased || historyBusy) || entry.status === 'running' || (running && run.id === entry.id)
          const button = (label, onClick, extra = {}) => h('button', {
            type: 'button', className: 't3d-btn sm ghost', disabled: locked, onClick, ...extra,
          }, label)
          const actions = editing
            ? [
                button(t('save'), () => renameRun(entry.id), { disabled: locked || !historyDraft.trim() }),
                button(t('cancel'), () => setHistoryEditing('')),
              ]
            : [
                   entry.final?.file ? button(t('rename'), () => {
                    setHistoryError('')
                    setChoice(null)
                    setHistoryEditing(entry.id)
                    setHistoryDraft(String(entry.final.file).replace(/\.[a-z0-9]+$/i, ''))
                  }, { title: t('renameHint') }) : null,
                  entry.final?.file ? button(t('reveal'), () => revealRun(entry.id), { title: t('revealHint') }) : null,
                  entry.final?.file || entry.unavailableExport?.state === 'missing' ? button(t('deleteExport'), () => chooseDelete('export', entry)) : null,
                   button(t('deleteProject'), () => chooseDelete('project', entry)),
                ]
          return h('div', { className: 't3d-history-item', key: entry.id },
            h('span', { className: 'when' }, fmtClock(entry.finishedAt || entry.createdAt)),
            editing
              ? h('input', {
                  className: 't3d-input what', value: historyDraft, autoFocus: true,
                  disabled: locked, 'aria-label': t('renameHint'),
                  onChange: (event) => setHistoryDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') { event.preventDefault(); renameRun(entry.id) }
                    else if (event.key === 'Escape' && !historyBusy) setHistoryEditing('')
                  },
                })
              : h('button', {
                  type: 'button', className: 'what', disabled: locked,
                  title: entry.final?.path || (entry.error ? 'This project reported an error.' : ''),
                  onClick: () => { setSelectedId(entry.id); setHistoryPreview(entry.final ? historyFileUrl(entry) : ''); setPreviewStage('') },
                }, entry.final?.file || `${entry.image || entry.id} · ${statusLabel(entry.status)}`),
            h('span', { className: 'size' }, entry.final?.bytes ? fmtBytes(entry.final.bytes) : ''),
            h('div', { className: 't3d-history-actions' }, ...actions),
          )
        }

        const imageUrl = image?.assetId ? '/tiiny-video/asset/' + encodeURIComponent(image.assetId) : image?.dataUrl || ''
        const blockedEntry = Object.entries(stageRecords).find(([, record]) => record?.needsReset)
        const waitingEntry = Object.entries(stageRecords).find(([, record]) => record?.waiting)

        return h(
          'div',
          { className: 't3d-page', lang:'en' }, h('style', null, CSS),
          choice ? h(ActionDialog, {key:choice.action + (choice.id || ''), choice, busy:Boolean(historyBusy), error:historyError, t, cancel:()=>{setChoice(null); setHistoryError('')}, submit:submitChoice}) : null,
          h('span', {className:'t3d-sr', role:'status', 'aria-atomic':true}, visible ? deleteNotice : ''),
          h(
            'div',
            { className: 't3d-head' },
            h('div', { className: 't3d-head-mark' }, h(Icon, { size: 18 })),
            h(
              'div',
              { className: 't3d-head-text' },
              h('h2', { className: 't3d-head-title', style: { margin: 0 } }, t('title')),
              h('div', { className: 't3d-head-sub' }, status?.model ? `${status.model} · ${t('subtitle')}` : t('subtitle')),
            ),
            h('div', { className: 't3d-head-spacer' }),
            connection.fixable
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 't3d-chip action',
                    title: connection.help,
                    onClick: () => openSettings(true),
                  },
                  h('i', { className: `t3d-dot ${connection.tone}` }),
                  connection.label,
                  h('span', { className: 't3d-arrow' }, '▸'),
                )
              : h(
                  'div',
                  { className: 't3d-chip', title: connection.help || undefined },
                  h('i', { className: `t3d-dot ${connection.tone}` }),
                  connection.label,
                  status?.version?.version ? ` · ${status.version.version}` : '',
                ),
            h('button', { type: 'button', className: 't3d-btn ghost', onClick: () => loadStatus(), disabled: statusBusy }, statusBusy ? t('connecting') : t('refresh')),
            h('button', { type: 'button', className: `t3d-btn ${showSettings ? 'primary' : 'ghost'}`, 'aria-expanded': showSettings, disabled: launching || busy, onClick: () => setShowSettings((value) => !value) }, t('settings')),
          ),
          h(
            'div',
            { className: 't3d-body' },
            h(
              'div',
              { className: 't3d-col left', ref: leftColRef },
              renderSettings(), modelControls,
              h(
                'div',
                { className: 't3d-card' },
                h('div', { className: 't3d-card-head' }, t('image')),
                h(
                  'div',
                  { className: 't3d-card-body' },
                  h(
                    'div',
                    {
                      className: `t3d-drop ${over ? 'over' : ''}`,
                      role: 'button', tabIndex: 0, 'aria-label': t('dropImage'),
                      onKeyDown: (event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          fileInput.current?.click()
                        }
                      },
                      onClick: () => fileInput.current?.click(),
                      onDragOver: (event) => {
                        event.preventDefault()
                        setOver(true)
                      },
                      onDragLeave: () => setOver(false),
                      onDrop: (event) => {
                        event.preventDefault()
                        setOver(false)
                        const file = event.dataTransfer?.files?.[0]
                        if (file) void pickFile(file)
                      },
                    },
                    imageUrl ? h('img', { src: imageUrl, alt: image?.name || t('image') }) : h('div', { className: 't3d-drop-hint' }, t('dropImage')),
                  ),
                  h('input', {
                    ref: fileInput,
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/webp',
                    style: { display: 'none' },
                    onChange: (event) => {
                      const file = event.target.files?.[0]
                      if (file) void pickFile(file)
                      event.target.value = ''
                    },
                  }),
                  h(
                    'div',
                    { className: 't3d-row' },
                    imageUrl ? h('button', { type: 'button', className: 't3d-btn ghost', onClick: () => { uploadVersion.current++; setImage(null); setNoticeKey(''); setReading(false) } }, t('clearImage')) : null,
                    image?.name ? h('span', { className: 't3d-meta', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, image.name) : null,
                  ),
                  noticeKey ? h('div', { className: 't3d-meta', role: 'status' }, t(noticeKey)) : null,
                  !imageUrl ? h('button', { type: 'button', className: 't3d-btn ghost', onClick: onMakeImage }, t('chooseStudioImage')) : null,
                  h('div', { className: 't3d-meta' }, t('imageHint')),
                ),
              ),
              h(
                'div',
                { className: 't3d-card' },
                h('div', { className: 't3d-card-head' }, t('generation')),
                h(
                  'div',
                  { className: 't3d-card-body' },
                  h(
                    'div',
                    { className: 't3d-field' },
                    h('div', { className: 't3d-label' }, t('qualityLabel')),
                    h(
                      'div',
                      { className: 't3d-seg', role:'group', 'aria-label': t('qualityLabel') },
                      ...['fast', 'balance', 'quality'].map((value) =>
                        h(
                          'button',
                          {
                            key: value,
                            type: 'button',
                            className: preset === value ? 'on' : '', 'aria-pressed': preset === value,
                            onClick: () => setPreset(value),
                          },
                          t(value === 'fast' ? 'presetFast' : value === 'balance' ? 'presetBalance' : 'presetQuality'),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { className: 't3d-meta' },
                      t(preset === 'fast' ? 'presetFastHint' : preset === 'balance' ? 'presetBalanceHint' : 'presetQualityHint'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 't3d-row' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 't3d-btn primary block',
                        disabled: writeBlocked || running || busy || launching || reading || !imageUrl || !apiKeyReady || !status?.ok,
                        title: !apiKeyReady ? t('needKeyFirst') : !imageUrl ? t('needImage') : !status?.ok ? t('needsRefresh') : '',
                        onClick: () => startRun()},
                      running ? (cancelling ? t('cancelling') : t('generating')) : t('generate'),
                    ),
                  ),
                  running
                    ? h(
                        'div',
                        { className: 't3d-row' },
                        h('button', { type: 'button', className: 't3d-btn ghost', disabled: cancelBusy || cancelling, onClick: () => cancelRun() }, cancelBusy || cancelling ? t('cancelling') : t('cancelRun')),
                        run?.phase === 'settle' ? h('button', { type: 'button', className: 't3d-btn ghost', onClick: () => skipSettle() }, t('skipSettle')) : null,
                      )
                    : null,
                  cancelling ? h('div', { className: 't3d-warn', role: 'status' }, t('cancelPendingHint')) : null,
                  error ? h('div', { className: 't3d-error', role: 'alert' }, error) : null,
                  settingsDirty ? h('div', { className: 't3d-warn' }, t('unsavedSettings'), ' ', h('button', { type: 'button', className: 't3d-btn sm', onClick: () => openSettings() }, t('settings'))) : null,
                  !status?.ok && apiKeyReady ? h('p', { className: 't3d-meta' }, t('needsRefresh')) : null,
                  !apiKeyReady && !showSettings
                    ? h(
                        'button',
                        { type: 'button', className: 't3d-cta', onClick: () => openSettings(true), title: t('needKeyFirst') },
                        h('span', { className: 't3d-cta-title' }, t('keyNeeded')),
                        h('span', { className: 't3d-cta-action' }, `${t('addKey')} ▸`),
                      )
                    : null,
                  h(
                    'button',
                    { type: 'button', className: 't3d-btn ghost block', 'aria-expanded': showAdvanced, onClick: () => setShowAdvanced((value) => !value) },
                    showAdvanced ? t('advancedHide') : t('advancedShow'),
                  ),
                  showAdvanced
                    ? h(
                        'div',
                        { className: 't3d-field' },
                        h(
                          'div',
                          { className: 't3d-row' },
                          h(
                            'div',
                            { className: 't3d-field' },
                            h('div', { className: 't3d-label' }, t('seed')),
                            h(
                              'div',
                              { className: 't3d-row' },
                              h('input', {
                                className: 't3d-number',
                                type: 'number',
                                value: seed, 'aria-label': t('seed'),
                                style: { width: '100%' },
                                onChange: (event) => setSeed(Number(event.target.value))},
                              ),
                              h('button', { type: 'button', className: 't3d-btn sm', 'aria-label': t('randomSeed'), title: t('randomSeed'), onClick: () => setSeed(Math.floor(Math.random() * 1000000)) }, '🎲'),
                            ),
                          ),
                          h(
                            'div',
                            { className: 't3d-field' },
                            h('div', { className: 't3d-label' }, t('settleDelay')),
                            h('input', {
                              className: 't3d-number',
                              type: 'number',
                              min: 0,
                              max: 300,
                              value: options.settleDelay, 'aria-label': t('settleDelay'),
                              onChange: (event) => setOptions({ ...options, settleDelay: Number(event.target.value) })},
                            ),
                          ),
                        ),
                        h(
                          'label',
                          { className: 't3d-switch' },
                          h('input', { type: 'checkbox', checked: options.simplify, onChange: (event) => setOptions({ ...options, simplify: event.target.checked }) }),
                          t('runSimplify'),
                        ),
                        h(
                          'label',
                          { className: 't3d-switch' },
                          h('input', { type: 'checkbox', checked: options.polish, onChange: (event) => setOptions({ ...options, polish: event.target.checked }) }),
                          t('runPolish'),
                        ),
                        h('div', { className: 't3d-meta' }, `${t('simplifyHint')} · ${t('settleHint')} · ${t('polishHint')}`),
                      )
                    : null,
                  showAdvanced && extrasGroups.length
                    ? h(
                        'div',
                        { className: 't3d-field' },
                        h('div', { className: 't3d-label' }, t('extraOptions')),
                        h('div', { className: 't3d-meta' }, t('extraHint')),
                        ...extrasGroups.map((group) =>
                          h(
                            'div',
                            { key: group.stage, className: 't3d-field', style: { gap: 6, marginTop: 4 } },
                            h('div', { className: 't3d-meta' }, stageLabel(group.stage)),
                            ...group.params.map((param) => {
                              const key = `${group.stage}:${param.name}`
                              const enabled = Boolean(extrasEnabled[key])
                              const control =
                                param.type === 'enum' && param.options
                                  ? h(
                                      'select',
                                      {
                                        className: 't3d-select',
                                        style: { width: 118 },
                                        disabled: !enabled,
                                        value: extras[key] ?? param.default ?? param.options[0],
                                        onChange: (event) => setExtras({ ...extras, [key]: event.target.value })},
                                      param.options.map((option) => h('option', { key: option, value: option }, option)),
                                    )
                                  : param.type === 'boolean'
                                    ? h('input', {
                                        type: 'checkbox',
                                        disabled: !enabled,
                                        checked: Boolean(extras[key]),
                                        onChange: (event) => setExtras({ ...extras, [key]: event.target.checked })},
                                      )
                                    : h('input', {
                                        className: 't3d-number',
                                        style: { width: 118 },
                                        type: param.type === 'number' ? 'number' : 'text',
                                        disabled: !enabled,
                                        value: extras[key] ?? param.default ?? '',
                                        title: `Native model parameter: ${param.name}`,
                                        onChange: (event) => setExtras({ ...extras, [key]: event.target.value })},
                                      )
                              return h(
                                'div',
                                { className: 't3d-row', key },
                                h(
                                  'label',
                                  { className: 't3d-switch', style: { flex: 1, minWidth: 140 } },
                                  h('input', {
                                    type: 'checkbox',
                                    checked: enabled,
                                    onChange: (event) => setExtrasEnabled({ ...extrasEnabled, [key]: event.target.checked })},
                                  ),
                                  param.name,
                                ),
                                control,
                              )
                            }),
                          ),
                        ),
                      )
                    : null,
                ),
              ),
              h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head' },
                  h('button', {
                    id:'t3d-history-heading', type: 'button', className: 't3d-btn sm ghost', 'aria-expanded': showHistory,
                    onClick: () => setShowHistory((value) => !value),
                  }, `${showHistory ? '−' : '+'} ${t('history')}${history.length ? ` (${history.length})` : ''}`),
                  h('span', { style: { flex: 1 } }),
                  history.some(entry => ['failed','cancelled'].includes(entry.status)) ? h('button', {
                     type:'button', className:'t3d-btn sm ghost', disabled:Boolean(leased || historyBusy), onClick:()=>openChoice({action:'failed', projects:history.filter(r=>['failed','cancelled'].includes(r.status)).slice(0,200).map(r=>({id:r.id,status:r.status,finishedAt:r.finishedAt ?? null}))}),
                   }, t('clearFailed')) : null,
                 ),
                 historyError ? h('div', { className: 't3d-card-body' }, h('div', { className: 't3d-error', role: 'alert' }, historyError)) : null,
                savedGlbs.length ? h('section', {className:'t3d-card-body', 'aria-label':'Saved GLB exports'}, h('strong',null,'Saved GLB exports'),
                  h('div', {className:'t3d-meta'}, 'These files were kept when their projects were deleted.'),
                  ...savedGlbs.map(row=>h('div',{key:row.id,className:'t3d-file'},h('span',{className:'name', title:row.path},row.file),
                    row.state === 'available' ? h('button',{type:'button',className:'t3d-btn sm ghost',onClick:()=>setHistoryPreview(historyFileUrl({id:row.id,final:row}))},t('preview')) : h('span', {className:'t3d-meta'}, {missing:'File missing', changed:'File changed', unverified:'Ownership unverified'}[row.state] || 'Unavailable'),
                    row.state === 'available' ? h('a',{className:'t3d-link',href:historyFileUrl({id:row.id,final:row}),download:row.file},t('download')) : null,
                    row.state === 'available' ? deleteButton('export',row,t('deleteExport'),true) : deleteButton('forget',row,'Forget listing',true)))) : null,
                showHistory
                  ? h('div', { className: 't3d-card-body', style: { gap: 6 } },
                      history.length
                        ? h('div', { className: 't3d-history' }, ...history.map(renderHistoryEntry))
                        : h('div', { className: 't3d-empty' }, t('noHistory')),
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { className: 't3d-col right' },
              h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head' },
                  t('pipeline'),
                  h('span', { style: { flex: 1 } }),
                  run
                    ? h(
                        'span',
                        { className: 't3d-meta' },
                        `${t('totalTime')} ${fmtMs((run.finishedAt || Date.now()) - run.createdAt)} · ${run.progress || 0}%`,
                      )
                    : null,
                ),
                h(
                  'div',
                  { className: 't3d-card-body', style: { gap: 8 } },
                  jobError ? h('div', { role: 'status', className: 't3d-warn' }, `${t('pollError')} ${jobError}`) : null,
                  ...visibleStages
                    .filter((stage) => stage !== 'simplify' || simplifyInPlan)
                    .map((stage, index) => renderStageRow(stage, index)),
                  blockedEntry && !cancelling
                    ? h(
                        'div',
                        { className: 't3d-warn', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                        h('span', null, t('waitingManual', { detail: 'reset required' })),
                        h(
                          'div',
                          { className: 't3d-row' },
                          h('button', { type: 'button', className: 't3d-btn sm', disabled: cancelBusy || cancelling, onClick: () => resumeRun() }, t('resume')),
                          h('button', { type: 'button', className: 't3d-btn sm ghost', disabled: cancelBusy || cancelling, onClick: () => cancelRun() }, cancelBusy || cancelling ? t('cancelling') : t('cancelRun')),
                        ),
                      )
                    : waitingEntry && !cancelling
                      ? h('div', { className: 't3d-meta' }, t('waitingAuto', { detail: 'reset required' }))
                      : null,
                ),
              ),
              h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head' },
                  t('preview'),
                  h('span', { style: { flex: 1 } }),
                  h(
                    'div',
                    { className: 't3d-tabs' },
                    ...previewOptions.map(([value, label]) =>
                      h(
                        'button',
                        {
                          key: value,
                          type: 'button',
                          'aria-pressed': previewStage === value && !historyPreview, className: `t3d-tab ${previewStage === value && !historyPreview ? 'on' : ''}`,
                          onClick: () => {
                            setPreviewStage(value)
                            setHistoryPreview('')
                          }},
                        label,
                      ),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 't3d-card-body' },
                  visible ? h(GlbPreview, { url: previewUrl, t }) : null,
                  previewProject || previewStandalone ? deleteButton('export', previewProject || previewStandalone, t('deleteExport'), Boolean(previewStandalone))
                    : !historyPreview && previewStage === 'file' && run?.final ? deleteButton('export', run, t('deleteExport')) : null,
                  h('div', { className: 't3d-meta t3d-preview-help' }, t('previewHint')),
                ),
              ),
              !run
                ? null
                : h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head' },
                  t('result'), deleteButton('project', run, t('deleteProject')),
                  run?.final ? h('span', { className: 't3d-meta t3d-artifact-path', title: run.final.path }, run.final.path) : null,
                  run?.final
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 't3d-btn sm ghost',
                          onClick: copyFinalPath,
                        },
                        copiedPath === run.final.path ? t('copied') : t('copyPath'),
                      )
                    : null,
                ),
                h(
                  'div',
                  { className: 't3d-card-body' },
                  run?.final
                    ? h(
                        'div',
                        { className: 't3d-file' },
                        h('span', { className: 'name', style: { fontWeight: 600 } }, run.final.file),
                        h('span', { className: 'size' }, fmtBytes(run.final.bytes)),
                        h(
                          'a',
                          { className: 't3d-link', href: run.finalUrl || historyFileUrl(run), download: run.final.file },
                          t('download'),
                        ),
                        deleteButton('export', run, t('deleteExport')),
                      )
                    : null,
                  h(
                    'div',
                    { className: 't3d-files' },
                    ...['background', 'shape', 'simplify', 'texture', 'export']
                      .filter((stage) => stageRecords[stage]?.file)
                      .map((stage) =>
                        h(
                          'div',
                          { className: 't3d-file', key: stage },
                          h('span', { className: 'size' }, stageLabel(stage)),
                          h('span', { className: 'name' }, stageRecords[stage].file),
                          h('span', { className: 'size' }, fmtBytes(stageRecords[stage].bytes)),
                          h(
                            'a',
                            { className: 't3d-link', href: stageRecords[stage].url, download: stageRecords[stage].file },
                            t('download'),
                       ),
                        ),
                      ),
                  ),
                  !run?.final && !Object.values(stageRecords).some((record) => record?.file)
                    ? h('div', { className: 't3d-empty' }, t('noArtifacts'))
                    : null,
                  run.unavailableExport ? h('div',{className:'t3d-meta'},t('exportUnavailable',{file:run.unavailableExport.file})) : null,
                  h('div',{className:'t3d-meta'},t('stageFilesHelp')),
                  copyError ? h('div', { className: 't3d-error', role: 'alert' }, copyError) : null,
                  run?.error ? h('div', { className: 't3d-error', role: 'alert' }, 'The run reported a problem. Check its stage status and the device in TiinyOS.') : null,
                ),
              ),
              h(
                'div',
                { className: 't3d-card' },
                h(
                  'div',
                  { className: 't3d-card-head', style: { cursor: 'pointer' }, onClick: () => setShowLog((value) => !value) },
                  t('log'),
                  h('span', { style: { flex: 1 } }),
                  h('span', { className: 't3d-meta' }, showLog ? '−' : '+'),
                ),
                showLog
                  ? h(
                      'div',
                      { className: 't3d-card-body', style: { paddingTop: 8 } },
                      h(
                        'div',
                        { className: 't3d-log', ref: logRef },
                        ...(run?.log || []).map((line, index) =>
                          h(
                            'div',
                            { key: index, className: line.level || 'info' },
                            h('span', { className: 't' }, new Date(line.t).toLocaleTimeString('en-US', { hour12: false })),
                            logMessage(line),
                          ),
                        ),
                        !run?.log?.length ? h('div', { className: 't3d-meta' }, '—') : null,
                      ),
                    )
                  : null,
              ),
            ),
          ),
        )
    }

    function Icon({ size = 20 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M12 2.8 21 7.6v8.8L12 21.2 3 16.4V7.6L12 2.8Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M3.4 7.7 12 12.2l8.6-4.5M12 12.2v8.6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', opacity: 0.9 }),
      )
    }

    return { Panel, dictionaries: TEXT }
}
