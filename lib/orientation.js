let EPS = 1e-8;

module.exports = function orientation(scene, options = {}) {
  if (!scene) scene = window.scene;
  const layer = options.layer || scene.queryLayer();
  const grid = layer.grid;

  let buckets = [];
  let bucketCount = options.count || 42;
  let dAngle = Math.PI / bucketCount;
  let innerRadius = options.r === undefined ? 100 : options.r;
  let maxWidth = options.width || Math.min(window.innerWidth, window.innerHeight) * 0.2;
  const circleDiameter = 2 * (innerRadius + maxWidth);

  let strokeWidth = options.strokeWidth === undefined ? 0.5 : options.strokeWidth;
  let strokeColor = options.strokeColor || 'black';
  let color = options.color || scene.background.toRgbString();
  let highlightedBuckets = new Set();

  const wgl = scene.getWGL();
  const wglRenderer = scene.getRenderer();

  let highlightedLines;

  let maxBucketLength = -Infinity;
  forEachWay(countBuckets);

  const svgContent = getSVGContentForBuckets();
  appendSVGContentToBody(svgContent);

  scene.on('dispose', onDispose);
  scene.on('color-change', onColorChange);
  scene.on('background-color', onBackgroundChange);

  function countBuckets(from, to) {
    let bucketNumber = getAngleBucket(from, to)
    if (bucketNumber === undefined) return;

    let angleLength = (buckets[bucketNumber] || 0) + 
      Math.hypot(from.y - to.y, from.x - to.x);

    if (angleLength > maxBucketLength) maxBucketLength = angleLength;

    buckets[bucketNumber] = angleLength;
    buckets[bucketNumber + bucketCount] = angleLength;
  }

  function getSVGContentForBuckets() {
    const paths = buckets.map((count, bucketNumber) => {
      let value = count / maxBucketLength;
      let angle = bucketNumber * Math.PI / bucketCount;
      return `<path 
    d='${pieSlice(innerRadius, maxWidth * value, angle, angle + dAngle)}'
    stroke-width='${strokeWidth}'
    stroke='${strokeColor}'
    fill='${color}'
    data-bucket='${bucketNumber % bucketCount}'/>`;
    }).join('\n');

    const x = Math.round(- circleDiameter / 2);
    return `<svg viewBox='${x} ${x} ${circleDiameter} ${circleDiameter}' style='width:100%; height: 100%;' class='printable'><g>${paths}</g></svg>`;
  }

  function appendSVGContentToBody(svgContent) {
    removeOurSVGContainer();

    const svgContainer = document.createElement('div');
    svgContainer.classList.add('script-content');
    svgContainer.classList.add('can-drag');
    svgContainer.classList.add('orientation');

    svgContainer.innerHTML = svgContent;
    const style = svgContainer.style;
    style.position = 'fixed';
    style.bottom  = '12px';
    style.pointerEvents = 'none';
    style.width = (innerRadius + 2 * maxWidth) + 'px'

    svgContainer.addEventListener('click', handleClick, true);
    // svgContainer.addEventListener('mousemove', handleMove, true);

    document.body.appendChild(svgContainer);
  }

  function onColorChange(layer) {
    if (layer !== highlightedLines) return;
    fillLinesWithColor(getHighlightRGBAFromLayer(highlightedLines), color);
  }

  function onBackgroundChange() {
    color = scene.background.toRgbString();
    fillLinesWithColor(getHighlightRGBAFromLayer(highlightedLines), color);
  }

  function onDispose() {
    scene.off('dispose', onDispose);
    scene.off('color-change', onColorChange);
    scene.off('background-color', onBackgroundChange);

    removeOurSVGContainer();
  }

  function removeOurSVGContainer() {
    let container = getSVGContainer();
    if (container) {
      container.removeEventListener('click', handleClick, true);
      container.removeEventListener('mousemove', handleMove, true);

      document.body.removeChild(container);
    }
  }

  function getSVGContainer() {
    return document.querySelector('.script-content.orientation');
  }

  function handleClick(e) {
    e.preventDefault();

    if (e.altKey) {
      invertSelection();
    } else {
      let newBucket = getBucketNumberFromCoordinates(e.clientX, e.clientY);
      if (newBucket === undefined) return;

      if (!e.shiftKey) highlightedBuckets.clear()

      if (highlightedBuckets.has(newBucket)) {
        highlightedBuckets.delete(newBucket);
      } else {
        highlightedBuckets.add(newBucket);
      }
    }

    showHighlightedLines();
  }

  function invertSelection() {
    let newSelection = new Set(); 
    for (let i = 0; i < bucketCount; ++i) {
      if (!highlightedBuckets.has(i)) newSelection.add(i);
    }
    highlightedBuckets = newSelection;
  }

  function handleMove(e) {
    let newBucket = getBucketNumberFromCoordinates(e.clientX, e.clientY);
    if (newBucket === undefined) return;
    let svgContainer = getSVGContainer();
    //let paths = svgContainer.querySelectorAll(`[data-bucket="${newBucket}"]`);

    let paths = svgContainer.querySelectorAll(`path`);
    Array.from(paths).forEach(path => {
      let bucket = getBucketNumberFromElement(path);
      path.setAttributeNS(null, 'stroke', newBucket == bucket ? 'red' : strokeColor);
    })
  }

  function getBucketNumberFromCoordinates(x, y) {
    let svgContainer = getSVGContainer();
    let rect = svgContainer.getBoundingClientRect();
    x -= rect.left;
    y -= rect.top;
    
    return getAngleBucket({x: rect.width / 2, y: -rect.height / 2}, {x, y: -y});
  }

  function getBucketNumberFromElement(element) {
    let bucket = element.getAttribute('data-bucket');
    if (typeof bucket !== 'string') return;

    return Number.parseInt(bucket, 10) % bucketCount;
  }

  function showHighlightedLines() {
    let previousHighlightColor;
    if (highlightedLines) {
      previousHighlightColor = highlightedLines.color;
      wglRenderer.removeChild(highlightedLines);
    }

    let highlighColor = getHighlightRGBAFromLayer(highlightedLines);
    fillLinesWithColor(highlighColor, color);

    highlightedLines = new wgl.WireCollection(100, {allowColors: false, is3D: false});
    highlightedLines.id = 'orientation';
    highlightedLines.color = previousHighlightColor || {r: 1, g: 0, b: 0, a: 1};

    forEachWay(function(from, to) {
      let bucketNumber = getAngleBucket(from, to)
      if (!highlightedBuckets.has(bucketNumber)) return;
      highlightedLines.add({from, to})
    });

    wglRenderer.appendChild(highlightedLines);
  }

  function fillLinesWithColor(highlighColor, normalColor) {
    const svgContainer = getSVGContainer();
    if (!svgContainer) return;
    Array.from(svgContainer.querySelectorAll('path')).forEach(path => {
      let bucket = getBucketNumberFromElement(path);
      path.setAttributeNS(null, 'fill', highlightedBuckets.has(bucket) ? highlighColor : normalColor);
    });
  }

  function forEachWay(callback) {
    let positions = grid.nodes;
    let project = grid.getProjector();
    grid.elements.forEach(element => {
      if (element.type !== 'way') return;

      let nodeIds = element.nodes;
      let node = positions.get(nodeIds[0])
      if (!node) return;

      let last = project(node);
      for (let index = 1; index < nodeIds.length; ++index) {
        node = positions.get(nodeIds[index])
        if (!node) continue;
        let next = project(node);
        callback(last, next);

        last = next;
      }
    });
  }

  function getAngleBucket(from, to) {
    let angle = getAngle(from, to);
    if (angle === undefined) return;

    let bucketNumber = Math.floor(bucketCount * angle / Math.PI);
    if (bucketNumber === bucketCount) bucketNumber -= 1;
    return bucketNumber;
  }

  function getAngle(from, to) {
    let dx = to.x - from.x;
    // SVG and WebGL have opposite directions, thus changing sign here:
    let dy = -to.y + from.y;

    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return;

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI; // So that we are in the [0..Pi] plane

    return angle;
  }
}

function pieSlice(r, width, startAngle, endAngle) {
  var inner = arcSegment(r, startAngle, endAngle, 1);
  var out = arcSegment(r + width, endAngle, startAngle, 0);
  return inner.d + 'L' + out.start.x + ' ' + out.start.y + out.d + 'L' + inner.start.x + ' ' + inner.start.y;
}

function arcSegment(radius, startAngle, endAngle, forward) {
  var cx = 0;
  var cy = 0;

  forward = forward ? 1 : 0;
  var start = polarToCartesian(cx, cy, radius, startAngle);
  var end = polarToCartesian(cx, cy, radius, endAngle);
  var da = Math.abs(startAngle - endAngle);
  var flip = da > Math.PI ? 1 : 0;
  var d = ["M", start.x, start.y, "A", radius, radius, 0, flip, forward, end.x, end.y].join(" ");

  return {
    d: d,
    start: start,
    end: end
  };
}

function polarToCartesian(centerX, centerY, radius, angle) {
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle)
  };
}

function getHighlightRGBAFromLayer(layer) {
  if (!layer) return 'rgba(255, 0, 0, 1)';
  let color = layer.color;
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
}