// Presentation only. A confirmed deletion changes the list; it never needs a visible success banner.
export default function historyFeedbackTools() {
  function confirmedRemoval(item, request) {
    if (request.scope === 'job') return { announcement: !item.hasOutput ? 'jobRemoved' : request.deleteOutput ? 'jobAndOutputRemoved' : 'jobRemovedKept', retainedId: null }
    if (!item.id.startsWith('file:')) return { announcement: 'outputRemoved', retainedId: item.id }
    return { announcement: item.canForget && !item.hasOutput ? 'forgotLibrary' : item.assetId ? 'libraryRemoved' : 'fileRemoved', retainedId: null }
  }
  // In particular, a kept output may reappear as a standalone item after the read-only rescan.
  function historyIsEmpty(count, read, deleting, issue) {
    return count === 0 && read.ready === true && !read.busy && !read.error && !deleting && !issue
  }
  return { confirmedRemoval, historyIsEmpty }
}
