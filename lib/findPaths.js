/**
 * This module renders shortest paths on a city roads graph.
 * 
 * Usage example:
 * 
 * ``` js
 * let city = await requireModule('https://cdn.jsdelivr.net/gh/anvaka/city-script/dist/city-script.js');
 *
 * city.findPaths(scene, {
 *   from: { lat: 47.8167059, lon: -122.3293886 }
 * })
 * ```
 */
let createRandom = require('ngraph.random')
let toGraph = require('./toGraph');
let npath = require('ngraph.path');

let distances = {
  manhattan,
  euclid,
  projected,
  canberra
}

module.exports = function findPaths(scene, options) {
  if (!scene) scene = window.scene;
  options = options || {};

  // We will be using seed random number generator, so that results are predictable.
  const random = createRandom(options.seed || 42);

  // How many shortest paths do we want?
  let count = options.pathCount || 2000;

  // How exactly should we measure a distance between two nodes?
  let distanceFunction = getDistanceFunction(options.distance);

  // Helper data structures to perform graph algorithms.
  let {graph, nodes, nodeIds, projector, mainLayer} = getGraphFromScene(scene);

  // Should we search single source shortest paths, or just randomly sample graph?
  let foundFromId = getSourceNodeId(options.from);

  // Sometimes they want to keep the original city. Otherwise let's clear it
  if (!options.keepScene) mainLayer.hide();

  let linksCount = graph.getLinksCount();
  let wgl = scene.getWGL();

  const wglRenderer = scene.getRenderer()

  const pathLimit = linksCount * 10;
  let betweenLines = new wgl.WireCollection(pathLimit, {
    allowColors: false,
    is3D: false
  });
  betweenLines.id = 'paths';
  updateLinesColorFromScene();
  wglRenderer.appendChild(betweenLines);

  let totalAdded = 0;
  let explored = 0;

  let pathFinder = npath.nba(graph, {
      distance: distance,
      heuristic: distance
  });

  // Timeout is better than animation frame, as this could be done even when
  // tab is closed.
  let handle = setTimeout(compute, 0);

  // This is console API. Allows clients to dispose, or get access to the 
  // wire collection.
  return {
    dispose,
    lines: betweenLines
  }

  function dispose() {
    clearTimeout(handle);
    scene.off('color-change', onColorChange);
  }

  function compute() {
    let elapsedTime = 0;
    let startTime = window.performance.now();
    let timeLimit = 20;

    while (elapsedTime < timeLimit && explored < count) {
      let fromId = foundFromId || nodeIds[Math.floor(random.nextDouble() * nodeIds.length)];
      let toId = nodeIds[Math.floor(random.nextDouble() * nodeIds.length)];

      let found = pathFinder.find(fromId, toId).map(l => l.data);

      for (let i = 1; i < found.length; ++i) {
        betweenLines.add({from: projector(found[i - 1]), to: projector(found[i])});
      }

      totalAdded += found.length;
      explored += 1;
      if (explored % 50 === 0) {
        console.info('Explored ' + explored + ' shortest paths.');
      }
      elapsedTime = (window.performance.now() - startTime);
    }

    if (totalAdded < pathLimit && explored < count) {
      handle = setTimeout(compute, 0);
    }
    wglRenderer.renderFrame();
  }

  function distance(n1, n2) {
    return distanceFunction(n1.data, n2.data);
  }

  function updateLinesColorFromScene() {
    let color = scene.lineColor.toRgb()
    betweenLines.color = {
      r: color.r/255,
      g: color.g/255,
      b: color.b/255,
      a: options.alpha || color.a //  0.05?
    }
    if (wglRenderer) wglRenderer.renderFrame();
  }

  function getSourceNodeId(nearOption) {
    if (!nearOption) return; // they don't care. The algorithm runs for random pairs.
    let lonLat = nearOption;
    if(typeof lonLat === 'string') {
      let parts = nearOption.split(',').map(x => parseFloat(x)).filter(x => Number.isFinite(x));
      if (parts.length !== 2) {
        throw new Error('Expected "lat,lon" format. Try {near: \'47.6689054,-122.3867575\'}');
      }
      lonLat = {
        lat: parts[0],
        lon: parts[1]
      }
    }

    let nodeId = findIdNear(lonLat)
    if (nodeId === undefined) {
      throw new Error('Cannot find the node near ' + nearOption);
    }

    return nodeId;
  }

  function findIdNear(targetNode) {
    if (!(Number.isFinite(targetNode.lon) && Number.isFinite(targetNode.lat))) {
      return; // Something isn't right.
    }

    let minDistance = Infinity;
    let minId = undefined;
    nodes.forEach(node => {
      let dist = euclid(node, targetNode);
      if (dist < minDistance) {
        minDistance = dist;
        minId = node.id;
      }
    });
    return minId;
  }
}

function getDistanceFunction(optionsFunction) {
  let distanceFunction = projected;
  if (typeof optionsFunction === 'function') {
    distanceFunction = optionsFunction;
  } else if (distances[optionsFunction]) {
    distanceFunction = distances[optionsFunction];
  }

  return distanceFunction;
}

function getGraphFromScene(scene) {
  let mainLayer = scene.queryLayer();
  let projector = mainLayer.grid.getProjector();

  let nodes = mainLayer.grid.nodes;
  let nodeIds = Array.from(nodes.keys());

  let graph = toGraph(mainLayer)

  return {projector, graph, nodes, nodeIds, mainLayer};
}

function canberra(node1, node2) {
  return Math.abs(node1.lat - node2.lat)/(Math.abs(node1.lat) + Math.abs(node2.lat)) + 
    Math.abs(node1.lon - node2.lon)/(Math.abs(node1.lon) + Math.abs(node2.lon));
}

function manhattan(node1, node2) {
  return Math.abs(node1.lat - node2.lat) + Math.abs(node1.lon - node2.lon);
}

function euclid(node1, node2) {
  return Math.hypot(node1.lat - node2.lat, node1.lon - node2.lon);
}

function projected(node1, node2) {
  let p = 0.017453292519943295;    // Math.PI / 180
  let c = Math.cos;
  let a = 0.5 - c((node2.lat - node1.lat) * p)/2 + 
          c(node1.lat * p) * c(node2.lat * p) * 
          (1 - c((node2.lon - node1.lon) * p))/2;

  return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
}

module.exports.distances = distances;