// Worker stub for physics off-main-thread (v2 scratch)
self.onmessage = (e)=>{
  // future: rapier step
  postMessage({type:'tick', pos:e.data})
}
