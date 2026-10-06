// Worker timers aren't throttled in hidden pages. The recorder sets the frame interval.
let timer = setInterval(() => postMessage(0), 66);
onmessage = (e) => {
  clearInterval(timer);
  timer = setInterval(() => postMessage(0), e.data);
};
