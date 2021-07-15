/**
 * Split city into `count` parts. Each part will have an assigned central node such that
 * all nodes inside this part are the nearest to the central node.
 */
let createRandom = require('ngraph.random')
let toGraph = require('./toGraph');
let prevPickerDispose;

module.exports = function splitToParts(partsCount, options = {}) {
  if (partsCount === undefined) partsCount = 7;

  const scene = options.scene || window.scene;
  // We will be using seed random number generator, so that results are predictable.
  const random = createRandom(options.seed || 42);
  if (prevPickerDispose) prevPickerDispose();
  prevPickerDispose = dispose;

  let wgl = scene.getWGL();
  const wglRenderer = scene.getRenderer()
  let isMaxDistanceStrategy = options.strategy === 'max';

  let {graph, nodes, nodeIds, projector, mainLayer} = getGraphFromScene(scene);
  if (!options.keepScene) mainLayer.hide();
  let largestComponentNode = getLargestComponentNode(graph);
  let componentId = largestComponentNode.componentId;
  let colors = generateColors(partsCount, random);

  let allPivots = assignPivotNodes(graph, largestComponentNode, random, partsCount, isMaxDistanceStrategy);
  let lines = [];
  for (let i = 0; i < partsCount; ++i) {
    let collection = new wgl.WireCollection(1000, {
      allowColors: false,
      is3D: false
    });
    collection.color = toRGBA(colors[i]);
    collection.id = 'c-' + i;
    lines.push(collection);
    wglRenderer.appendChild(collection);
  }

  let pivotToComponent = new Map();
  let pointCollection;
  
  if (options.centerSize) {
    pointCollection = new wgl.PointCollection(allPivots.length, {
      is3D: false,
      allowColors: true
    });

    allPivots.forEach((node) => {
      let pos = projector(nodes.get(node.id));
      let componentId = getComponentIdFromPivotId(node.pivot);
      pointCollection.add({
        x: pos.x,
        y: pos.y,
        size: options.centerSize,
        color: colors[componentId]
      })
    });
    wglRenderer.appendChild(pointCollection);
  }

  graph.forEachLink(link => {
    let from = graph.getNode(link.fromId);
    let to = graph.getNode(link.toId);
    if (from.pivot && from.pivot === to.pivot) {
      let componentId = getComponentIdFromPivotId(from.pivot);
      let targetCollection = lines[componentId];
      targetCollection.add({from: projector(nodes.get(link.fromId)), to: projector(nodes.get(link.toId))});
    } 
  });

  return {
    dispose
  }

  function getComponentIdFromPivotId(pivotId) {
    if (pivotToComponent.has(pivotId)) {
      return pivotToComponent.get(pivotId);
    }
    let nextPivotId = pivotToComponent.size;
    pivotToComponent.set(pivotId, nextPivotId);
    return nextPivotId;
  }

  function dispose() {
    lines.forEach(collection => {
      wglRenderer.removeChild(collection);
    });
    if (pointCollection) wglRenderer.removeChild(pointCollection);
  }
}


function getGraphFromScene(scene) {
  let mainLayer = scene.queryLayer();
  let projector = mainLayer.grid.getProjector();

  let nodes = mainLayer.grid.nodes;
  let nodeIds = Array.from(nodes.keys());

  let graph = toGraph(mainLayer)

  return {projector, graph, nodes, nodeIds, mainLayer};
}

function getLargestComponentNode(graph) {
  let componentId = 0;
  let largestComponentId = -1;
  let largestComponentSize = -1;

  graph.forEachNode(node => {
    if (node.visited) return;
    let totalVisited = bfs(node, componentId);
    if (totalVisited > largestComponentSize) {
      largestComponentSize = totalVisited;
      largestComponentId = componentId;
    }

    componentId += 1;
  });

  let startFrom;
  graph.forEachNode(node => {
    if (node.componentId === largestComponentId) {
      startFrom = node;
      return true;
    }
  });

  return startFrom;

  function bfs(node, componentId) {
    let q = [node];
    node.visited = true;
    let totalVisited = 0;

    while (q.length) {
      let current = q.shift();
      current.componentId = componentId;
      totalVisited += 1;

      graph.forEachLinkedNode(current.id, other => {
        if (other.visited) return;
        other.visited = true;
        q.push(other);
      });
    }

    return totalVisited;
  }
}

function assignPivotNodes(graph, largestComponentNode, random, partsCount, isMaxDistanceStrategy) {
  let nodes = [];

  graph.forEachNode(node => {
    node.minDistance = Infinity;
    node.pivot = null;
    if (node.componentId === largestComponentNode.componentId) {
      nodes.push(node);
    }
  });

  let pivot = nodes[0];
  let allPivots = [pivot];

  maxMinBFS(graph, pivot);
  for (let i = 1; i < partsCount; ++i) {
    let maxDistance = -Infinity;
    let nextPivot = null;

    if (isMaxDistanceStrategy) {
      nodes.forEach(node => {
        if (node.minDistance > maxDistance) {
          maxDistance = node.minDistance;
          nextPivot = node;
        }
      });
    } else {
      let totalDistance = 0;
      nodes.forEach(node => { totalDistance += node.minDistance; });
      let pickProbability = random.next(totalDistance);
      let cumulativeProbability = 0;

      for(let j = 0; j < nodes.length; ++j) {
        let node = nodes[j];
        cumulativeProbability += node.minDistance;
        if (cumulativeProbability > pickProbability) {
          nextPivot = node;
          break;
        }
      }
    }

    allPivots.push(nextPivot);
    maxMinBFS(graph, nextPivot);
  }

  return allPivots;
}

function maxMinBFS(graph, start) {
  let q = [{id: start.id, d: 0}];
  start.minDistance = 0;
  start.pivot = start.id;

  let visited = new Set();
  visited.add(start.id);

  while (q.length > 0) {
    let current = q.shift();
    graph.forEachLinkedNode(current.id, toNode => {
      if (visited.has(toNode.id)) return;
      visited.add(toNode.id);
      q.push({id: toNode.id, d: current.d + 1});

      if (toNode.minDistance > current.d + 1) {
        toNode.minDistance = current.d + 1;
        toNode.pivot = start.id;
      }
    })
  }
}

function generateColors(partsCount, random) {
  let protoColors = [0x1abc9cff, 0x2ecc71ff, 0x3498dbff, 0x9b59b6ff, 0x34495eff, 0xf1c40fff, 0xe67e22ff, 0xe74c3cff, 0x95a5a6ff, 0x7f8c8dff, 0x9c27b0ff, 0x1b5e20ff, 0x2d7f6eff, 0x2980b9ff, 0x16a61eff, 0x203635ff, 0x6baed6ff, 0x9e9e9eff, 0x9d6e0dff, 0x79c6c6ff, 0x8d7500ff, 0x7530aaff, 0x6d004bff, 0x66a6a6ff, 0x5aae61ff, 0x57a5a8ff, 0x41ab5dff, 0x4898d3ff, 0x3f738dff, 0x3d85c6ff, 0x3566c9ff];
  let colors = [];
  for (let i = 0; i < partsCount; ++i) {
    colors.push(protoColors[i % protoColors.length]);
  }
  return colors;
}

function toRGBA(color) {
  return { 
    r: (color >> 24 & 0xff) / 255, 
    g: (color >> 16 & 0xff) / 255, 
    b: (color >> 8 & 0xff) / 255, 
    a: (color & 0xff) / 255
   };
}