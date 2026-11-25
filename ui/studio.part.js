(React, media, three) => {
  const { createElement: h, useState, useCallback, useEffect, useRef } = React
  const NS = 'dsh-tiiny-video.studio'
  const nativeKey = (key) => `three.${key}`
  const COPY = {
    studioTitle: 'Tiiny Studio', chooseWorkspace: 'Creation workspace', imageTab: 'Image', videoTab: 'Video', threeTab: '3D',
    intro: 'Create an image, turn it into a video, or use it to build a textured 3D model.',
    inUse: 'The device is in use: {task}. You can edit this draft while you wait.', libraryBusy: 'Studio is updating the 3D library. You can keep editing this draft.',
    imageTask: 'image generation', videoTask: 'video generation', threeTask: '3D generation', loadTask: 'loading a 3D model', otherTask: 'another task', checkActivity: 'Check again',
  }
  const css = `
    .tiiny-studio { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; overflow:hidden; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font:inherit; font-size:14px; }
    .tiiny-studio__head { flex:none; border-bottom:1px solid var(--dsw-alias-border-l1); }
    .tiiny-studio__bar { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px 24px; align-items:center; width:100%; max-width:1100px; box-sizing:border-box; margin:0 auto; padding:clamp(12px,2.4vw,26px) clamp(14px,4vw,48px) 12px; }
    .tiiny-studio__brand { flex:1 1 280px; min-width:0; } .tiiny-studio__brand h1 { margin:0; font-size:22px; line-height:1.25; font-weight:650; }
    .tiiny-studio__brand p { color:var(--dsw-alias-label-secondary); margin:4px 0 0; font-size:13px; overflow-wrap:anywhere; }
    .tiiny-studio__picker { display:inline-flex; align-items:center; margin:0; padding:3px; gap:2px; min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; }
    .tiiny-studio__picker label { position:relative; cursor:pointer; } .tiiny-studio__sr { position:absolute; clip-path:inset(50%); width:1px; height:1px; overflow:hidden; white-space:nowrap; }
    .tiiny-studio__picker span { display:block; padding:5px 13px; border-radius:6px; border:1px solid transparent; }
    .tiiny-studio__picker input:checked + span { border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); font-weight:600; }
    .tiiny-studio__picker input:focus-visible + span,.tiiny-studio__activity button:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
    .tiiny-studio__activity { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:0; padding:6px clamp(14px,4vw,48px); background:var(--dsw-alias-bg-layer-2); font-size:13px; }
    .tiiny-studio__activity button { color:var(--dsw-alias-brand-primary); text-decoration:underline; background:transparent; border:0; font:inherit; cursor:pointer; }
    .tiiny-studio__view { flex:1; min-height:0; min-width:0; } .tiiny-studio__view[hidden] { display:none; }
    @media (pointer:coarse) { .tiiny-studio__picker span { padding:9px 13px; } }
  `
  // Only reads the Host's local lease. This is not a native model probe and never submits a task.
  function useActivity(mode) {
    const [activity, setActivity] = useState(null)
    const request = useRef(null)
    const refresh = useCallback(async () => {
      if (document.hidden) return
      request.current?.abort()
      const saved = new AbortController()
      request.current = saved
      try {
        const result = await fetch('/tiiny-video/activity', { cache: 'no-store', signal: saved.signal })
        if (!result.ok) throw new Error(`HTTP ${result.status}`)
        const state = await result.json()
        if (!saved.signal.aborted) setActivity(state?.busy ? state : null)
      } catch { if (!saved.signal.aborted) setActivity(null) } // The Host still arbitrates all writes.
    }, [])
    useEffect(() => {
      void refresh()
      const timer = setInterval(refresh, 6000)
      document.addEventListener('visibilitychange', refresh)
      return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); request.current?.abort() }
    }, [mode, refresh])
    return [activity, refresh]
  }
  function Studio({ t, locale }) {
    const [mode, setMode] = useState('video')
    const [mediaMode, setMediaMode] = useState('video')
    const [openedThree, setOpenedThree] = useState(false)
    const [reference, setReference] = useState(null)
    const [unavailableAsset, setUnavailableAsset] = useState(null)
    const stagedId = useRef('')
    const onAssetMissing = useCallback((id) => {
      if (id !== stagedId.current) return
      stagedId.current = ''; setReference(null); setUnavailableAsset({ id })
    }, [])
    const [activity, refresh] = useActivity(mode)
    const choose = useCallback((next) => {
      if (next === '3d') setOpenedThree(true)
      else setMediaMode(next)
      setMode(next)
    }, [])
    const stage = useCallback((job) => {
      if (job.kind !== 'image' || job.status !== 'completed' || !job.assetId) return
      // Transfer only the opaque reference and its display name – no upload or automatic inference.
      stagedId.current = job.assetId; setUnavailableAsset(null)
      setReference({ assetId: job.assetId, name: job.file || job.name || '' }); choose('3d')
    }, [choose])
    const native = mode === '3d'
    const libraryLease = activity?.kind === '3d-library'
    const nativeLease = libraryLease || activity?.kind === '3d' || activity?.kind === '3d-load'
    const busy = Boolean(activity?.busy)
    const lease = busy ? `${activity.kind}:${activity.since || ''}` : ''
    const conflict = busy && (native !== nativeLease || activity.kind === '3d-load' || libraryLease)
    const labelKey = ({ image: 'imageTask', video: 'videoTask', '3d': 'threeTask', '3d-load': 'loadTask' })[activity?.kind] || 'otherTask'
    const nativeT = useCallback((key, vars) => t(nativeKey(key), vars), [t, locale])
    return h('div', { className: 'tiiny-studio', lang: 'en' }, h('style', null, css),
      h('header', { className: 'tiiny-studio__head' }, h('div', { className: 'tiiny-studio__bar' },
        h('div', { className: 'tiiny-studio__brand' }, h('h1', null, t('studioTitle')), h('p', null, t('intro'))),
        h('fieldset', { className: 'tiiny-studio__picker' }, h('legend', { className: 'tiiny-studio__sr' }, t('chooseWorkspace')),
          [['image', 'imageTab'], ['video', 'videoTab'], ['3d', 'threeTab']].map(([id, key]) => h('label', { key: id },
            h('input', { type: 'radio', name: 'tiiny-studio-workspace', className: 'tiiny-studio__sr', checked: mode === id, onChange: () => choose(id) }), h('span', null, t(key))))))),
      conflict ? h('div', { role: 'status', className: 'tiiny-studio__activity' }, libraryLease ? t('libraryBusy') : t('inUse', { task: t(labelKey) }),
        h('button', { type: 'button', onClick: refresh }, t('checkActivity'))) : null,
      h('div', { className: 'tiiny-studio__view', hidden: native }, h(media.Panel, { t, locale, mode: mediaMode, setMode: choose, visible: !native,
        onThree: stage, stagedThreeAssetId: reference?.assetId, onAssetMissing, leased: busy, ownLease: !nativeLease ? lease : '', onActivity: refresh })),
      openedThree ? h('div', { className: 'tiiny-studio__view', hidden: !native }, h(three.Panel, { t: nativeT, locale, visible: native, reference, unavailableAsset,
        leased: busy, ownLease: nativeLease && !libraryLease ? lease : '', onMakeImage: () => choose('image'), onActivity: refresh })) : null)
  }
  function Icon({ size = 20, active = false }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2 : 1.6, strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M3 7.5 12 3l9 4.5-9 4.5zM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5' }))
  }
  return {
    inject: ['slots', 'locale'],
    apply(ctx) {
      // Both supported Harness locales resolve Studio's single English pack; never change the user's Harness locale.
      const english = { ...media.dictionary(), ...COPY,
        ...Object.fromEntries(Object.entries(three.dictionaries.en).map(([key, value]) => [nativeKey(key), value])),
      }
      ctx.effect(() => ctx.locale.register(NS, { en: english, zh: english }))
      const translate = ctx.locale.bind(NS)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'tiiny-video', locale: NS },
        ({ t }) => h(Studio, { t: t || translate, locale: 'en-US' })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'tiiny-video', order: 20, label: () => translate('studioTitle') }, Icon))
    },
  }
}
