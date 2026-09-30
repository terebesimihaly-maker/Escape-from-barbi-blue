/* Test hook: with ?clock=manual in the URL, animation frames only advance when a test calls __step(frames, ms) (for frame-exact captures). */
if(location.search.includes('clock=manual')){window.__q=[];window.__t=performance.now();window.requestAnimationFrame=cb=>{__q.push(cb);return 1};window.__step=(n,ms)=>{for(let i=0;i<n;i++){__t+=ms;const q=__q;__q=[];q.forEach(cb=>cb(__t));}};}
