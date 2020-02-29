(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.city = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

module.exports = {
  findPaths: require('./lib/findPaths'),
  elevation: require('./lib/elevation')
}
},{"./lib/elevation":2,"./lib/findPaths":3}],2:[function(require,module,exports){
const MAPBOX_TOKEN = 'pk.eyJ1IjoiYW52YWthIiwiYSI6ImNqaWUzZmhqYzA1OXMza213YXh2ZzdnOWcifQ.t5yext53zn1c9Ixd7Y41Dw';
const apiURL = `https://api.mapbox.com/v4/mapbox.terrain-rgb/zoom/tLong/tLat@2x.pngraw?access_token=${MAPBOX_TOKEN}`;
const tileSize = 512;
let imageCache = new Map();
const d2r = Math.PI / 180;

module.exports = function elevation(scene, options = {}) {
  let mainLayer = scene.queryLayer();
  const grid = mainLayer.grid;
  let nodes = grid.nodes;
  let colorLayer = new Map();
  let bounds = {
    west: Infinity,
    south: Infinity,
    north: -Infinity,
    east: -Infinity
  };
  nodes.forEach(node => {
    if (node.lat < bounds.south) bounds.south = node.lat;
    if (node.lat > bounds.north) bounds.north = node.lat;
    if (node.lon < bounds.west) bounds.west = node.lon;
    if (node.lon > bounds.east) bounds.east = node.lon;
  });

  const elevationTiles = getTileCover(bounds);

  return loadTiles(elevationTiles).then(makePublicAPI);

  function makePublicAPI(elevationAPI) {
    return {
      drawWithColor(getColor) {
        return renderHeights(elevationAPI, getColor);
      },
      drawWithHeight(height, belowWaterColor = 0xff0000ff) {
        let color = scene.lineColor.toRgb();
        let defaultColor = (color.r << 24) | (color.g << 16) | (color.b << 8) | Math.round(color.a * 0xff);
        return renderHeights(elevationAPI, pointHeight => pointHeight < height ? belowWaterColor : defaultColor)
      }
    }
  }

  function renderHeights(api, getColor) {
    // Sometimes they want to keep the original city. Otherwise let's clear it
    if (!options.keepScene) scene.clear();
    ensureLicenseVisible();

    let wgl = scene.getWGL();
    colorLayer.forEach(layer => {
      layer.parent.removeChild(layer);
    })
    colorLayer = new Map();

    forEachWay(function(from, to) {
      let layer = colorLayer.get(from.color);
      if (!layer) {
        layer = new wgl.WireCollection(1024);
        layer.color.r = ((from.color >> 24) & 0xff)/0xff;
        layer.color.g = ((from.color >> 16) & 0xff)/0xff;
        layer.color.b = ((from.color >> 8) & 0xff)/0xff;
        layer.color.a = ((from.color >> 0) & 0xff)/0xff;
        colorLayer.set(from.color, layer);
      }
      layer.add({from, to});
    });

    colorLayer.forEach(layer => {
      scene.getRenderer().appendChild(layer);
    })

    function forEachWay(callback) {
      let positions = nodes;
      let project = grid.getProjector();
      grid.elements.forEach(element => {
        if (element.type !== 'way') return;

        let nodeIds = element.nodes;
        let node = positions.get(nodeIds[0])
        if (!node) return;

        let last = project(node);
        last.z = api.getElevation(node.lon, node.lat);
        last.color = getColor(last.z);

        for (let index = 1; index < nodeIds.length; ++index) {
          node = positions.get(nodeIds[index])
          if (!node) continue;
          let next = project(node);
          next.z = api.getElevation(node.lon, node.lat)
          next.color = getColor(next.z);
          callback(last, next);

          last = next;
        }
      });
    }
  }

  function ensureLicenseVisible() {
    if (document.querySelector('.license.printable .mapbox')) return;
    let a = document.createElement('a');
    a.target = '_blank';
    a.href = 'https://www.mapbox.com/about/maps/';
    a.innerText = '© Mapbox';
    a.classList.add('mapbox');
    let osmLink = document.querySelector('.license.printable a');
    if (osmLink) {
      a.style.color = osmLink.style.color;
    }
    a.style.marginLeft = '2px';
    document.querySelector('.license.printable').appendChild(a);
  }
}

function getTileCover(bounds) {
  let zoomLevel;
  let latDiff = bounds.north - bounds.south;
  let lngDiff = bounds.east - bounds.west;

  let maxDiff = (lngDiff > latDiff) ? lngDiff : latDiff;
  if (maxDiff < 360 / Math.pow(2, 20)) zoomLevel = 21;
  else {
    zoomLevel = (-1*( (Math.log(maxDiff)/Math.log(2)) - (Math.log(360)/Math.log(2))));
    if (zoomLevel < 1) zoomLevel = 1;
  }

  zoomLevel = Math.floor(zoomLevel) + 1;
  let sw = pointToTile(bounds.west, bounds.south, zoomLevel);
  let se = pointToTile(bounds.east, bounds.south, zoomLevel);
  let ne = pointToTile(bounds.east, bounds.north, zoomLevel);
  let nw = pointToTile(bounds.west, bounds.north, zoomLevel);
  let minX = Math.min(sw[0], nw[0]);
  let minY = Math.min(ne[1], nw[1]);
  let maxX = Math.max(se[0], ne[0]);
  let maxY = Math.max(se[1], sw[1]);
  return {
    minX, minY, maxY, maxX, zoomLevel
  };
}

function getRequestForTile(x, y, z, tileBounds) {
  const url = apiURL
    .replace('zoom', z)
    .replace('tLat', y)
    .replace('tLong', x);

  return {
    url,
    x: tileSize * (x - tileBounds.minX), 
    y: tileSize * (y - tileBounds.minY)
  }
}

function loadTiles(tileBounds) {
  let {minX, minY, maxX, maxY, zoomLevel} = tileBounds;
  const widthInTiles = tileBounds.maxX - tileBounds.minX;
  const heightInTiles = tileBounds.maxY - tileBounds.minY;
  if (widthInTiles > 50 || heightInTiles > 50) throw new Error('Too many tiles requested. How did you do it?');

  let coveringTiles = [];
  for (let x = minX; x <= maxX; ++x) {
    for (let y = minY; y <= maxY; ++y) {
      let request = getRequestForTile(x, y, zoomLevel, tileBounds)
      coveringTiles.push(request);
    }
  }

  const canvas = document.createElement('canvas');
  let canvasWidth = canvas.width = (widthInTiles + 1) * tileSize;
  let canvasHeight = canvas.height = (heightInTiles + 1) * tileSize;

  const ctx = canvas.getContext('2d');
  let imageData;
  const tilesToLoad = coveringTiles.map(toLoadedTile)

  return Promise.all(tilesToLoad).then(constructAPI);

  function constructAPI() {
    imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;

    return {
      getElevation
    };
  }

  function getElevation(lon, lat) {
    let pos = pointToTileFraction(lon, lat, zoomLevel);
    let xC = Math.round((pos[0] - minX) * tileSize);
    let yC = Math.round((pos[1] - minY) * tileSize);
    let index = (yC * canvasWidth + xC) * 4;

    let R = imageData[index + 0];
    let G = imageData[index + 1];
    let B = imageData[index + 2];
    return decodeHeight(R, G, B);
  }

  function decodeHeight(R, G, B) {
    return -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
  }

  function toLoadedTile(request) {
    return loadImage(request.url)
      .then(drawTileImage)
      .catch(drawBlankTile)

    function drawTileImage(image) {
      ctx.drawImage(image, request.x, request.y);
    }

    function drawBlankTile() {
      ctx.beginPath();
      ctx.fillStyle = '#0186a0'; // zero height
      ctx.fillRect(request.x, request.y, tileSize, tileSize);
    }
  }
}

function loadImage(url) {
  let cachedImage = imageCache.get(url);
  if (!cachedImage) {
    cachedImage = new Promise((resolve, error) => {
      const img = new Image();
      img.onload = () => {
        resolve(img);
      };
      img.onerror = error;
      img.crossOrigin = "anonymous";
      img.src = url;
    });
    imageCache.set(url, cachedImage);
  }

  return cachedImage;
}

// this function is from https://github.com/mapbox/tilebelt/blob/master/index.js
// The MIT License (MIT)
// Copyright (c) 2014 Morgan Herlocker
function pointToTile(lon, lat, z) {
    var tile = pointToTileFraction(lon, lat, z);
    tile[0] = Math.floor(tile[0]);
    tile[1] = Math.floor(tile[1]);
    return tile;
}

// this function is from https://github.com/mapbox/tilebelt/blob/master/index.js
// The MIT License (MIT)
// Copyright (c) 2014 Morgan Herlocker
function pointToTileFraction(lon, lat, z) {
    var sin = Math.sin(lat * d2r),
        z2 = Math.pow(2, z),
        x = z2 * (lon / 360 + 0.5),
        y = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

    // Wrap Tile X
    x = x % z2
    if (x < 0) x = x + z2
    return [x, y, z];
}
},{}],3:[function(require,module,exports){
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
  options = options || {};

  // We will be using seed random number generator, so that results are predictable.
  const random = createRandom(options.seed || 42);

  // How many shortest paths do we want?
  let count = options.pathCount || 2000;

  // How exactly should we measure a distance between two nodes?
  let distanceFunction = getDistanceFunction(options.distance);

  // Helper data structures to perform graph algorithms.
  let {graph, nodes, nodeIds, projector} = getGraphFromScene(scene);

  // Should we search single source shortest paths, or just randomly sample graph?
  let foundFromId = getSourceNodeId(options.from);

  // Sometimes they want to keep the original city. Otherwise let's clear it
  if (!options.keepScene) scene.clear();

  let linksCount = graph.getLinksCount();
  let wgl = scene.getWGL();

  const wglRenderer = scene.getRenderer()

  const pathLimit = linksCount * 10;
  let betweenLines = new wgl.WireCollection(pathLimit);
  updateLinesColorFromScene();
  wglRenderer.appendChild(betweenLines);

  listenToEvents(scene);

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
    scene.off('line-color', updateLinesColorFromScene);
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

  function listenToEvents() {
    scene.on('line-color', updateLinesColorFromScene);
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
  let firstLayer = scene.queryLayer();
  let projector = firstLayer.grid.getProjector();

  let nodes = firstLayer.grid.nodes;
  let nodeIds = Array.from(nodes.keys());

  let graph = toGraph(firstLayer)

  return {projector, graph, nodes, nodeIds};
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
},{"./toGraph":4,"ngraph.path":15,"ngraph.random":16}],4:[function(require,module,exports){
let createGraph = require('ngraph.graph');

module.exports = function toGraph(osmElements) {
  if (!Array.isArray(osmElements)) {
    if (Array.isArray(osmElements.elements)) {
      osmElements = osmElements.elements;
    } else {
      osmElements = osmElements.grid && osmElements.grid.elements;
    }
  }
  if (!osmElements) {
    throw new Error('Expected either GridLayer, Grid, or array of elements to turn into graph');
  }

  let graph = createGraph();
  osmElements.forEach(element => {
    if (element.type === 'node') {
      graph.addNode(element.id, element);
    } else if (element.type === 'way') {
      let nodes = element.nodes;
      for (let i = 1; i < nodes.length; ++i) {
        graph.addLink(nodes[i - 1], nodes[i]);
      }
    }
  });
  return graph;

}
},{"ngraph.graph":6}],5:[function(require,module,exports){
module.exports = function eventify(subject) {
  validateSubject(subject);

  var eventsStorage = createEventsStorage(subject);
  subject.on = eventsStorage.on;
  subject.off = eventsStorage.off;
  subject.fire = eventsStorage.fire;
  return subject;
};

function createEventsStorage(subject) {
  // Store all event listeners to this hash. Key is event name, value is array
  // of callback records.
  //
  // A callback record consists of callback function and its optional context:
  // { 'eventName' => [{callback: function, ctx: object}] }
  var registeredEvents = Object.create(null);

  return {
    on: function (eventName, callback, ctx) {
      if (typeof callback !== 'function') {
        throw new Error('callback is expected to be a function');
      }
      var handlers = registeredEvents[eventName];
      if (!handlers) {
        handlers = registeredEvents[eventName] = [];
      }
      handlers.push({callback: callback, ctx: ctx});

      return subject;
    },

    off: function (eventName, callback) {
      var wantToRemoveAll = (typeof eventName === 'undefined');
      if (wantToRemoveAll) {
        // Killing old events storage should be enough in this case:
        registeredEvents = Object.create(null);
        return subject;
      }

      if (registeredEvents[eventName]) {
        var deleteAllCallbacksForEvent = (typeof callback !== 'function');
        if (deleteAllCallbacksForEvent) {
          delete registeredEvents[eventName];
        } else {
          var callbacks = registeredEvents[eventName];
          for (var i = 0; i < callbacks.length; ++i) {
            if (callbacks[i].callback === callback) {
              callbacks.splice(i, 1);
            }
          }
        }
      }

      return subject;
    },

    fire: function (eventName) {
      var callbacks = registeredEvents[eventName];
      if (!callbacks) {
        return subject;
      }

      var fireArguments;
      if (arguments.length > 1) {
        fireArguments = Array.prototype.splice.call(arguments, 1);
      }
      for(var i = 0; i < callbacks.length; ++i) {
        var callbackInfo = callbacks[i];
        callbackInfo.callback.apply(callbackInfo.ctx, fireArguments);
      }

      return subject;
    }
  };
}

function validateSubject(subject) {
  if (!subject) {
    throw new Error('Eventify cannot use falsy object as events subject');
  }
  var reservedWords = ['on', 'fire', 'off'];
  for (var i = 0; i < reservedWords.length; ++i) {
    if (subject.hasOwnProperty(reservedWords[i])) {
      throw new Error("Subject cannot be eventified, since it already has property '" + reservedWords[i] + "'");
    }
  }
}

},{}],6:[function(require,module,exports){
/**
 * @fileOverview Contains definition of the core graph object.
 */

// TODO: need to change storage layer:
// 1. Be able to get all nodes O(1)
// 2. Be able to get number of links O(1)

/**
 * @example
 *  var graph = require('ngraph.graph')();
 *  graph.addNode(1);     // graph has one node.
 *  graph.addLink(2, 3);  // now graph contains three nodes and one link.
 *
 */
module.exports = createGraph;

var eventify = require('ngraph.events');

/**
 * Creates a new graph
 */
function createGraph(options) {
  // Graph structure is maintained as dictionary of nodes
  // and array of links. Each node has 'links' property which
  // hold all links related to that node. And general links
  // array is used to speed up all links enumeration. This is inefficient
  // in terms of memory, but simplifies coding.
  options = options || {};
  if ('uniqueLinkId' in options) {
    console.warn(
      'ngraph.graph: Starting from version 0.14 `uniqueLinkId` is deprecated.\n' +
      'Use `multigraph` option instead\n',
      '\n',
      'Note: there is also change in default behavior: From now on each graph\n'+
      'is considered to be not a multigraph by default (each edge is unique).'
    );

    options.multigraph = options.uniqueLinkId;
  }

  // Dear reader, the non-multigraphs do not guarantee that there is only
  // one link for a given pair of node. When this option is set to false
  // we can save some memory and CPU (18% faster for non-multigraph);
  if (options.multigraph === undefined) options.multigraph = false;

  if (typeof Map !== 'function') {
    // TODO: Should we polyfill it ourselves? We don't use much operations there..
    throw new Error('ngraph.graph requires `Map` to be defined. Please polyfill it before using ngraph');
  } 

  var nodes = new Map();
  var links = [],
    // Hash of multi-edges. Used to track ids of edges between same nodes
    multiEdges = {},
    suspendEvents = 0,

    createLink = options.multigraph ? createUniqueLink : createSingleLink,

    // Our graph API provides means to listen to graph changes. Users can subscribe
    // to be notified about changes in the graph by using `on` method. However
    // in some cases they don't use it. To avoid unnecessary memory consumption
    // we will not record graph changes until we have at least one subscriber.
    // Code below supports this optimization.
    //
    // Accumulates all changes made during graph updates.
    // Each change element contains:
    //  changeType - one of the strings: 'add', 'remove' or 'update';
    //  node - if change is related to node this property is set to changed graph's node;
    //  link - if change is related to link this property is set to changed graph's link;
    changes = [],
    recordLinkChange = noop,
    recordNodeChange = noop,
    enterModification = noop,
    exitModification = noop;

  // this is our public API:
  var graphPart = {
    /**
     * Adds node to the graph. If node with given id already exists in the graph
     * its data is extended with whatever comes in 'data' argument.
     *
     * @param nodeId the node's identifier. A string or number is preferred.
     * @param [data] additional data for the node being added. If node already
     *   exists its data object is augmented with the new one.
     *
     * @return {node} The newly added node or node with given id if it already exists.
     */
    addNode: addNode,

    /**
     * Adds a link to the graph. The function always create a new
     * link between two nodes. If one of the nodes does not exists
     * a new node is created.
     *
     * @param fromId link start node id;
     * @param toId link end node id;
     * @param [data] additional data to be set on the new link;
     *
     * @return {link} The newly created link
     */
    addLink: addLink,

    /**
     * Removes link from the graph. If link does not exist does nothing.
     *
     * @param link - object returned by addLink() or getLinks() methods.
     *
     * @returns true if link was removed; false otherwise.
     */
    removeLink: removeLink,

    /**
     * Removes node with given id from the graph. If node does not exist in the graph
     * does nothing.
     *
     * @param nodeId node's identifier passed to addNode() function.
     *
     * @returns true if node was removed; false otherwise.
     */
    removeNode: removeNode,

    /**
     * Gets node with given identifier. If node does not exist undefined value is returned.
     *
     * @param nodeId requested node identifier;
     *
     * @return {node} in with requested identifier or undefined if no such node exists.
     */
    getNode: getNode,

    /**
     * Gets number of nodes in this graph.
     *
     * @return number of nodes in the graph.
     */
    getNodesCount: function () {
      return nodes.size;
    },

    /**
     * Gets total number of links in the graph.
     */
    getLinksCount: function () {
      return links.length;
    },

    /**
     * Gets all links (inbound and outbound) from the node with given id.
     * If node with given id is not found null is returned.
     *
     * @param nodeId requested node identifier.
     *
     * @return Array of links from and to requested node if such node exists;
     *   otherwise null is returned.
     */
    getLinks: getLinks,

    /**
     * Invokes callback on each node of the graph.
     *
     * @param {Function(node)} callback Function to be invoked. The function
     *   is passed one argument: visited node.
     */
    forEachNode: forEachNode,

    /**
     * Invokes callback on every linked (adjacent) node to the given one.
     *
     * @param nodeId Identifier of the requested node.
     * @param {Function(node, link)} callback Function to be called on all linked nodes.
     *   The function is passed two parameters: adjacent node and link object itself.
     * @param oriented if true graph treated as oriented.
     */
    forEachLinkedNode: forEachLinkedNode,

    /**
     * Enumerates all links in the graph
     *
     * @param {Function(link)} callback Function to be called on all links in the graph.
     *   The function is passed one parameter: graph's link object.
     *
     * Link object contains at least the following fields:
     *  fromId - node id where link starts;
     *  toId - node id where link ends,
     *  data - additional data passed to graph.addLink() method.
     */
    forEachLink: forEachLink,

    /**
     * Suspend all notifications about graph changes until
     * endUpdate is called.
     */
    beginUpdate: enterModification,

    /**
     * Resumes all notifications about graph changes and fires
     * graph 'changed' event in case there are any pending changes.
     */
    endUpdate: exitModification,

    /**
     * Removes all nodes and links from the graph.
     */
    clear: clear,

    /**
     * Detects whether there is a link between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     * NOTE: this function is synonim for getLink()
     *
     * @returns link if there is one. null otherwise.
     */
    hasLink: getLink,

    /**
     * Detects whether there is a node with given id
     * 
     * Operation complexity is O(1)
     * NOTE: this function is synonim for getNode()
     *
     * @returns node if there is one; Falsy value otherwise.
     */
    hasNode: getNode,

    /**
     * Gets an edge between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     *
     * @param {string} fromId link start identifier
     * @param {string} toId link end identifier
     *
     * @returns link if there is one. null otherwise.
     */
    getLink: getLink
  };

  // this will add `on()` and `fire()` methods.
  eventify(graphPart);

  monitorSubscribers();

  return graphPart;

  function monitorSubscribers() {
    var realOn = graphPart.on;

    // replace real `on` with our temporary on, which will trigger change
    // modification monitoring:
    graphPart.on = on;

    function on() {
      // now it's time to start tracking stuff:
      graphPart.beginUpdate = enterModification = enterModificationReal;
      graphPart.endUpdate = exitModification = exitModificationReal;
      recordLinkChange = recordLinkChangeReal;
      recordNodeChange = recordNodeChangeReal;

      // this will replace current `on` method with real pub/sub from `eventify`.
      graphPart.on = realOn;
      // delegate to real `on` handler:
      return realOn.apply(graphPart, arguments);
    }
  }

  function recordLinkChangeReal(link, changeType) {
    changes.push({
      link: link,
      changeType: changeType
    });
  }

  function recordNodeChangeReal(node, changeType) {
    changes.push({
      node: node,
      changeType: changeType
    });
  }

  function addNode(nodeId, data) {
    if (nodeId === undefined) {
      throw new Error('Invalid node identifier');
    }

    enterModification();

    var node = getNode(nodeId);
    if (!node) {
      node = new Node(nodeId, data);
      recordNodeChange(node, 'add');
    } else {
      node.data = data;
      recordNodeChange(node, 'update');
    }

    nodes.set(nodeId, node);

    exitModification();
    return node;
  }

  function getNode(nodeId) {
    return nodes.get(nodeId);
  }

  function removeNode(nodeId) {
    var node = getNode(nodeId);
    if (!node) {
      return false;
    }

    enterModification();

    var prevLinks = node.links;
    if (prevLinks) {
      node.links = null;
      for(var i = 0; i < prevLinks.length; ++i) {
        removeLink(prevLinks[i]);
      }
    }

    nodes.delete(nodeId)

    recordNodeChange(node, 'remove');

    exitModification();

    return true;
  }


  function addLink(fromId, toId, data) {
    enterModification();

    var fromNode = getNode(fromId) || addNode(fromId);
    var toNode = getNode(toId) || addNode(toId);

    var link = createLink(fromId, toId, data);

    links.push(link);

    // TODO: this is not cool. On large graphs potentially would consume more memory.
    addLinkToNode(fromNode, link);
    if (fromId !== toId) {
      // make sure we are not duplicating links for self-loops
      addLinkToNode(toNode, link);
    }

    recordLinkChange(link, 'add');

    exitModification();

    return link;
  }

  function createSingleLink(fromId, toId, data) {
    var linkId = makeLinkId(fromId, toId);
    return new Link(fromId, toId, data, linkId);
  }

  function createUniqueLink(fromId, toId, data) {
    // TODO: Get rid of this method.
    var linkId = makeLinkId(fromId, toId);
    var isMultiEdge = multiEdges.hasOwnProperty(linkId);
    if (isMultiEdge || getLink(fromId, toId)) {
      if (!isMultiEdge) {
        multiEdges[linkId] = 0;
      }
      var suffix = '@' + (++multiEdges[linkId]);
      linkId = makeLinkId(fromId + suffix, toId + suffix);
    }

    return new Link(fromId, toId, data, linkId);
  }

  function getLinks(nodeId) {
    var node = getNode(nodeId);
    return node ? node.links : null;
  }

  function removeLink(link) {
    if (!link) {
      return false;
    }
    var idx = indexOfElementInArray(link, links);
    if (idx < 0) {
      return false;
    }

    enterModification();

    links.splice(idx, 1);

    var fromNode = getNode(link.fromId);
    var toNode = getNode(link.toId);

    if (fromNode) {
      idx = indexOfElementInArray(link, fromNode.links);
      if (idx >= 0) {
        fromNode.links.splice(idx, 1);
      }
    }

    if (toNode) {
      idx = indexOfElementInArray(link, toNode.links);
      if (idx >= 0) {
        toNode.links.splice(idx, 1);
      }
    }

    recordLinkChange(link, 'remove');

    exitModification();

    return true;
  }

  function getLink(fromNodeId, toNodeId) {
    // TODO: Use sorted links to speed this up
    var node = getNode(fromNodeId),
      i;
    if (!node || !node.links) {
      return null;
    }

    for (i = 0; i < node.links.length; ++i) {
      var link = node.links[i];
      if (link.fromId === fromNodeId && link.toId === toNodeId) {
        return link;
      }
    }

    return null; // no link.
  }

  function clear() {
    enterModification();
    forEachNode(function(node) {
      removeNode(node.id);
    });
    exitModification();
  }

  function forEachLink(callback) {
    var i, length;
    if (typeof callback === 'function') {
      for (i = 0, length = links.length; i < length; ++i) {
        callback(links[i]);
      }
    }
  }

  function forEachLinkedNode(nodeId, callback, oriented) {
    var node = getNode(nodeId);

    if (node && node.links && typeof callback === 'function') {
      if (oriented) {
        return forEachOrientedLink(node.links, nodeId, callback);
      } else {
        return forEachNonOrientedLink(node.links, nodeId, callback);
      }
    }
  }

  function forEachNonOrientedLink(links, nodeId, callback) {
    var quitFast;
    for (var i = 0; i < links.length; ++i) {
      var link = links[i];
      var linkedNodeId = link.fromId === nodeId ? link.toId : link.fromId;

      quitFast = callback(nodes.get(linkedNodeId), link);
      if (quitFast) {
        return true; // Client does not need more iterations. Break now.
      }
    }
  }

  function forEachOrientedLink(links, nodeId, callback) {
    var quitFast;
    for (var i = 0; i < links.length; ++i) {
      var link = links[i];
      if (link.fromId === nodeId) {
        quitFast = callback(nodes.get(link.toId), link)
        if (quitFast) {
          return true; // Client does not need more iterations. Break now.
        }
      }
    }
  }

  // we will not fire anything until users of this library explicitly call `on()`
  // method.
  function noop() {}

  // Enter, Exit modification allows bulk graph updates without firing events.
  function enterModificationReal() {
    suspendEvents += 1;
  }

  function exitModificationReal() {
    suspendEvents -= 1;
    if (suspendEvents === 0 && changes.length > 0) {
      graphPart.fire('changed', changes);
      changes.length = 0;
    }
  }

  function forEachNode(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Function is expected to iterate over graph nodes. You passed ' + callback);
    }

    var valuesIterator = nodes.values();
    var nextValue = valuesIterator.next();
    while (!nextValue.done) {
      if (callback(nextValue.value)) {
        return true; // client doesn't want to proceed. Return.
      }
      nextValue = valuesIterator.next();
    }
  }
}

// need this for old browsers. Should this be a separate module?
function indexOfElementInArray(element, array) {
  if (!array) return -1;

  if (array.indexOf) {
    return array.indexOf(element);
  }

  var len = array.length,
    i;

  for (i = 0; i < len; i += 1) {
    if (array[i] === element) {
      return i;
    }
  }

  return -1;
}

/**
 * Internal structure to represent node;
 */
function Node(id, data) {
  this.id = id;
  this.links = null;
  this.data = data;
}

function addLinkToNode(node, link) {
  if (node.links) {
    node.links.push(link);
  } else {
    node.links = [link];
  }
}

/**
 * Internal structure to represent links;
 */
function Link(fromId, toId, data, id) {
  this.fromId = fromId;
  this.toId = toId;
  this.data = data;
  this.id = id;
}

function makeLinkId(fromId, toId) {
  return fromId.toString() + '👉 ' + toId.toString();
}

},{"ngraph.events":5}],7:[function(require,module,exports){
/**
 * Based on https://github.com/mourner/tinyqueue
 * Copyright (c) 2017, Vladimir Agafonkin https://github.com/mourner/tinyqueue/blob/master/LICENSE
 * 
 * Adapted for PathFinding needs by @anvaka
 * Copyright (c) 2017, Andrei Kashcha
 */
module.exports = NodeHeap;

function NodeHeap(data, options) {
  if (!(this instanceof NodeHeap)) return new NodeHeap(data, options);

  if (!Array.isArray(data)) {
    // assume first argument is our config object;
    options = data;
    data = [];
  }

  options = options || {};

  this.data = data || [];
  this.length = this.data.length;
  this.compare = options.compare || defaultCompare;
  this.setNodeId = options.setNodeId || noop;

  if (this.length > 0) {
    for (var i = (this.length >> 1); i >= 0; i--) this._down(i);
  }

  if (options.setNodeId) {
    for (var i = 0; i < this.length; ++i) {
      this.setNodeId(this.data[i], i);
    }
  }
}

function noop() {}

function defaultCompare(a, b) {
  return a - b;
}

NodeHeap.prototype = {

  push: function (item) {
    this.data.push(item);
    this.setNodeId(item, this.length);
    this.length++;
    this._up(this.length - 1);
  },

  pop: function () {
    if (this.length === 0) return undefined;

    var top = this.data[0];
    this.length--;

    if (this.length > 0) {
      this.data[0] = this.data[this.length];
      this.setNodeId(this.data[0], 0);
      this._down(0);
    }
    this.data.pop();

    return top;
  },

  peek: function () {
    return this.data[0];
  },

  updateItem: function (pos) {
    this._down(pos);
    this._up(pos);
  },

  _up: function (pos) {
    var data = this.data;
    var compare = this.compare;
    var setNodeId = this.setNodeId;
    var item = data[pos];

    while (pos > 0) {
      var parent = (pos - 1) >> 1;
      var current = data[parent];
      if (compare(item, current) >= 0) break;
        data[pos] = current;

       setNodeId(current, pos);
       pos = parent;
    }

    data[pos] = item;
    setNodeId(item, pos);
  },

  _down: function (pos) {
    var data = this.data;
    var compare = this.compare;
    var halfLength = this.length >> 1;
    var item = data[pos];
    var setNodeId = this.setNodeId;

    while (pos < halfLength) {
      var left = (pos << 1) + 1;
      var right = left + 1;
      var best = data[left];

      if (right < this.length && compare(data[right], best) < 0) {
        left = right;
        best = data[right];
      }
      if (compare(best, item) >= 0) break;

      data[pos] = best;
      setNodeId(best, pos);
      pos = left;
    }

    data[pos] = item;
    setNodeId(item, pos);
  }
};
},{}],8:[function(require,module,exports){
/**
 * Performs suboptimal, greed A Star path finding.
 * This finder does not necessary finds the shortest path. The path
 * that it finds is very close to the shortest one. It is very fast though.
 */
module.exports = aStarBi;

var NodeHeap = require('./NodeHeap');
var makeSearchStatePool = require('./makeSearchStatePool');
var heuristics = require('./heuristics');
var defaultSettings = require('./defaultSettings');

var BY_FROM = 1;
var BY_TO = 2;
var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`, it may be extended in future.
 * 
 * NOTE: Algorithm implemented in this code DOES NOT find optimal path.
 * Yet the path that it finds is always near optimal, and it finds it very fast.
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * 
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`.  Defaults function returns 0, which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * @param {Boolean} options.oriented - whether graph should be considered oriented or not.
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function aStarBi(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;
  var pool = makeSearchStatePool();

  return {
    find: find
  };

  function find(fromId, toId) {
    // Not sure if we should return NO_PATH or throw. Throw seem to be more
    // helpful to debug errors. So, throwing.
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);

    if (from === to) return [from]; // trivial case.

    pool.reset();

    var callVisitor = oriented ? orientedVisitor : nonOrientedVisitor;

    // Maps nodeId to NodeSearchState.
    var nodeState = new Map();

    var openSetFrom = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });

    var openSetTo = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });


    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode);

    // For the first node, fScore is completely heuristic.
    startNode.fScore = heuristic(from, to);
    // The cost of going from start to start is zero.
    startNode.distanceToSource = 0;
    openSetFrom.push(startNode);
    startNode.open = BY_FROM;

    var endNode = pool.createNewState(to);
    endNode.fScore = heuristic(to, from);
    endNode.distanceToSource = 0;
    openSetTo.push(endNode);
    endNode.open = BY_TO;

    // Cost of the best solution found so far. Used for accurate termination
    var lMin = Number.POSITIVE_INFINITY;
    var minFrom;
    var minTo;

    var currentSet = openSetFrom;
    var currentOpener = BY_FROM;

    while (openSetFrom.length > 0 && openSetTo.length > 0) {
      if (openSetFrom.length < openSetTo.length) {
        // we pick a set with less elements
        currentOpener = BY_FROM;
        currentSet = openSetFrom;
      } else {
        currentOpener = BY_TO;
        currentSet = openSetTo;
      }

      var current = currentSet.pop();

      // no need to visit this node anymore
      current.closed = true;

      if (current.distanceToSource > lMin) continue;

      graph.forEachLinkedNode(current.node.id, callVisitor);

      if (minFrom && minTo) {
        // This is not necessary the best path, but we are so greedy that we
        // can't resist:
        return reconstructBiDirectionalPath(minFrom, minTo);
      }
    }

    return NO_PATH; // No path.

    function nonOrientedVisitor(otherNode, link) {
      return visitNode(otherNode, link, current);
    }

    function orientedVisitor(otherNode, link) {
      // For oritned graphs we need to reverse graph, when traveling
      // backwards. So, we use non-oriented ngraph's traversal, and 
      // filter link orientation here.
      if (currentOpener === BY_FROM) {
        if (link.fromId === current.node.id) return visitNode(otherNode, link, current)
      } else if (currentOpener === BY_TO) {
        if (link.toId === current.node.id) return visitNode(otherNode, link, current);
      }
    }

    function canExit(currentNode) {
      var opener = currentNode.open
      if (opener && opener !== currentOpener) {
        return true;
      }

      return false;
    }

    function reconstructBiDirectionalPath(a, b) {
      var pathOfNodes = [];
      var aParent = a;
      while(aParent) {
        pathOfNodes.push(aParent.node);
        aParent = aParent.parent;
      }
      var bParent = b;
      while (bParent) {
        pathOfNodes.unshift(bParent.node);
        bParent = bParent.parent
      }
      return pathOfNodes;
    }

    function visitNode(otherNode, link, cameFrom) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) {
        // Already processed this node.
        return;
      }

      if (canExit(otherSearchState, cameFrom)) {
        // this node was opened by alternative opener. The sets intersect now,
        // we found an optimal path, that goes through *this* node. However, there
        // is no guarantee that this is the global optimal solution path.

        var potentialLMin = otherSearchState.distanceToSource + cameFrom.distanceToSource;
        if (potentialLMin < lMin) {
          minFrom = otherSearchState;
          minTo = cameFrom
          lMin = potentialLMin;
        }
        // we are done with this node.
        return;
      }

      var tentativeDistance = cameFrom.distanceToSource + distance(otherSearchState.node, cameFrom.node, link);

      if (tentativeDistance >= otherSearchState.distanceToSource) {
        // This would only make our path longer. Ignore this route.
        return;
      }

      // Choose target based on current working set:
      var target = (currentOpener === BY_FROM) ? to : from;
      var newFScore = tentativeDistance + heuristic(otherSearchState.node, target);
      if (newFScore >= lMin) {
        // this can't be optimal path, as we have already found a shorter path.
        return;
      }
      otherSearchState.fScore = newFScore;

      if (otherSearchState.open === 0) {
        // Remember this node in the current set
        currentSet.push(otherSearchState);
        currentSet.updateItem(otherSearchState.heapIndex);

        otherSearchState.open = currentOpener;
      }

      // bingo! we found shorter path:
      otherSearchState.parent = cameFrom;
      otherSearchState.distanceToSource = tentativeDistance;
    }
  }
}

},{"./NodeHeap":7,"./defaultSettings":10,"./heuristics":11,"./makeSearchStatePool":12}],9:[function(require,module,exports){
/**
 * Performs a uni-directional A Star search on graph.
 * 
 * We will try to minimize f(n) = g(n) + h(n), where
 * g(n) is actual distance from source node to `n`, and
 * h(n) is heuristic distance from `n` to target node.
 */
module.exports = aStarPathSearch;

var NodeHeap = require('./NodeHeap');
var makeSearchStatePool = require('./makeSearchStatePool');
var heuristics = require('./heuristics');
var defaultSettings = require('./defaultSettings.js');

var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`, it may be extended in future.
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`. This function should never overestimate actual distance between two
 * nodes (otherwise the found path will not be the shortest). Defaults function returns 0,
 * which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * @param {Boolean} options.oriented - whether graph should be considered oriented or not.
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function aStarPathSearch(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;
  var pool = makeSearchStatePool();

  return {
    /**
     * Finds a path between node `fromId` and `toId`.
     * @returns {Array} of nodes between `toId` and `fromId`. Empty array is returned
     * if no path is found.
     */
    find: find
  };

  function find(fromId, toId) {
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);
    pool.reset();

    // Maps nodeId to NodeSearchState.
    var nodeState = new Map();

    // the nodes that we still need to evaluate
    var openSet = new NodeHeap({
      compare: defaultSettings.compareFScore,
      setNodeId: defaultSettings.setHeapIndex
    });

    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode);

    // For the first node, fScore is completely heuristic.
    startNode.fScore = heuristic(from, to);

    // The cost of going from start to start is zero.
    startNode.distanceToSource = 0;
    openSet.push(startNode);
    startNode.open = 1;

    var cameFrom;

    while (openSet.length > 0) {
      cameFrom = openSet.pop();
      if (goalReached(cameFrom, to)) return reconstructPath(cameFrom);

      // no need to visit this node anymore
      cameFrom.closed = true;
      graph.forEachLinkedNode(cameFrom.node.id, visitNeighbour, oriented);
    }

    // If we got here, then there is no path.
    return NO_PATH;

    function visitNeighbour(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) {
        // Already processed this node.
        return;
      }
      if (otherSearchState.open === 0) {
        // Remember this node.
        openSet.push(otherSearchState);
        otherSearchState.open = 1;
      }

      var tentativeDistance = cameFrom.distanceToSource + distance(otherNode, cameFrom.node, link);
      if (tentativeDistance >= otherSearchState.distanceToSource) {
        // This would only make our path longer. Ignore this route.
        return;
      }

      // bingo! we found shorter path:
      otherSearchState.parent = cameFrom;
      otherSearchState.distanceToSource = tentativeDistance;
      otherSearchState.fScore = tentativeDistance + heuristic(otherSearchState.node, to);

      openSet.updateItem(otherSearchState.heapIndex);
    }
  }
}

function goalReached(searchState, targetNode) {
  return searchState.node === targetNode;
}

function reconstructPath(searchState) {
  var path = [searchState.node];
  var parent = searchState.parent;

  while (parent) {
    path.push(parent.node);
    parent = parent.parent;
  }

  return path;
}

},{"./NodeHeap":7,"./defaultSettings.js":10,"./heuristics":11,"./makeSearchStatePool":12}],10:[function(require,module,exports){
// We reuse instance of array, but we trie to freeze it as well,
// so that consumers don't modify it. Maybe it's a bad idea.
var NO_PATH = [];
if (typeof Object.freeze === 'function') Object.freeze(NO_PATH);

module.exports = {
  // Path search settings
  heuristic: blindHeuristic,
  distance: constantDistance,
  compareFScore: compareFScore,
  NO_PATH: NO_PATH,

  // heap settings
  setHeapIndex: setHeapIndex,

  // nba:
  setH1: setH1,
  setH2: setH2,
  compareF1Score: compareF1Score,
  compareF2Score: compareF2Score,
}

function blindHeuristic(/* a, b */) {
  // blind heuristic makes this search equal to plain Dijkstra path search.
  return 0;
}

function constantDistance(/* a, b */) {
  return 1;
}

function compareFScore(a, b) {
  var result = a.fScore - b.fScore;
  // TODO: Can I improve speed with smarter ties-breaking?
  // I tried distanceToSource, but it didn't seem to have much effect
  return result;
}

function setHeapIndex(nodeSearchState, heapIndex) {
  nodeSearchState.heapIndex = heapIndex;
}

function compareF1Score(a, b) {
  return a.f1 - b.f1;
}

function compareF2Score(a, b) {
  return a.f2 - b.f2;
}

function setH1(node, heapIndex) {
  node.h1 = heapIndex;
}

function setH2(node, heapIndex) {
  node.h2 = heapIndex;
}
},{}],11:[function(require,module,exports){
module.exports = {
  l2: l2,
  l1: l1
};

/**
 * Euclid distance (l2 norm);
 * 
 * @param {*} a 
 * @param {*} b 
 */
function l2(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Manhattan distance (l1 norm);
 * @param {*} a 
 * @param {*} b 
 */
function l1(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.abs(dx) + Math.abs(dy);
}

},{}],12:[function(require,module,exports){
/**
 * This class represents a single search node in the exploration tree for
 * A* algorithm.
 * 
 * @param {Object} node  original node in the graph
 */
function NodeSearchState(node) {
  this.node = node;

  // How we came to this node?
  this.parent = null;

  this.closed = false;
  this.open = 0;

  this.distanceToSource = Number.POSITIVE_INFINITY;
  // the f(n) = g(n) + h(n) value
  this.fScore = Number.POSITIVE_INFINITY;

  // used to reconstruct heap when fScore is updated.
  this.heapIndex = -1;
};

function makeSearchStatePool() {
  var currentInCache = 0;
  var nodeCache = [];

  return {
    createNewState: createNewState,
    reset: reset
  };

  function reset() {
    currentInCache = 0;
  }

  function createNewState(node) {
    var cached = nodeCache[currentInCache];
    if (cached) {
      // TODO: This almost duplicates constructor code. Not sure if
      // it would impact performance if I move this code into a function
      cached.node = node;
      // How we came to this node?
      cached.parent = null;

      cached.closed = false;
      cached.open = 0;

      cached.distanceToSource = Number.POSITIVE_INFINITY;
      // the f(n) = g(n) + h(n) value
      cached.fScore = Number.POSITIVE_INFINITY;

      // used to reconstruct heap when fScore is updated.
      cached.heapIndex = -1;

    } else {
      cached = new NodeSearchState(node);
      nodeCache[currentInCache] = cached;
    }
    currentInCache++;
    return cached;
  }
}
module.exports = makeSearchStatePool;
},{}],13:[function(require,module,exports){
module.exports = nba;

var NodeHeap = require('../NodeHeap');
var heuristics = require('../heuristics');
var defaultSettings = require('../defaultSettings.js');
var makeNBASearchStatePool = require('./makeNBASearchStatePool.js');

var NO_PATH = defaultSettings.NO_PATH;

module.exports.l2 = heuristics.l2;
module.exports.l1 = heuristics.l1;

/**
 * Creates a new instance of pathfinder. A pathfinder has just one method:
 * `find(fromId, toId)`.
 * 
 * This is implementation of the NBA* algorithm described in 
 * 
 *  "Yet another bidirectional algorithm for shortest paths" paper by Wim Pijls and Henk Post
 * 
 * The paper is available here: https://repub.eur.nl/pub/16100/ei2009-10.pdf
 * 
 * @param {ngraph.graph} graph instance. See https://github.com/anvaka/ngraph.graph
 * @param {Object} options that configures search
 * @param {Function(a, b)} options.heuristic - a function that returns estimated distance between
 * nodes `a` and `b`. This function should never overestimate actual distance between two
 * nodes (otherwise the found path will not be the shortest). Defaults function returns 0,
 * which makes this search equivalent to Dijkstra search.
 * @param {Function(a, b)} options.distance - a function that returns actual distance between two
 * nodes `a` and `b`. By default this is set to return graph-theoretical distance (always 1);
 * 
 * @returns {Object} A pathfinder with single method `find()`.
 */
function nba(graph, options) {
  options = options || {};
  // whether traversal should be considered over oriented graph.
  var oriented = options.oriented;
  var quitFast = options.quitFast;

  var heuristic = options.heuristic;
  if (!heuristic) heuristic = defaultSettings.heuristic;

  var distance = options.distance;
  if (!distance) distance = defaultSettings.distance;

  // During stress tests I noticed that garbage collection was one of the heaviest
  // contributors to the algorithm's speed. So I'm using an object pool to recycle nodes.
  var pool = makeNBASearchStatePool();

  return {
    /**
     * Finds a path between node `fromId` and `toId`.
     * @returns {Array} of nodes between `toId` and `fromId`. Empty array is returned
     * if no path is found.
     */
    find: find
  };

  function find(fromId, toId) {
    // I must apologize for the code duplication. This was the easiest way for me to
    // implement the algorithm fast.
    var from = graph.getNode(fromId);
    if (!from) throw new Error('fromId is not defined in this graph: ' + fromId);
    var to = graph.getNode(toId);
    if (!to) throw new Error('toId is not defined in this graph: ' + toId);

    pool.reset();

    // I must also apologize for somewhat cryptic names. The NBA* is bi-directional
    // search algorithm, which means it runs two searches in parallel. One is called
    // forward search and it runs from source node to target, while the other one
    // (backward search) runs from target to source.

    // Everywhere where you see `1` it means it's for the forward search. `2` is for 
    // backward search.

    // For oriented graph path finding, we need to reverse the graph, so that
    // backward search visits correct link. Obviously we don't want to duplicate
    // the graph, instead we always traverse the graph as non-oriented, and filter
    // edges in `visitN1Oriented/visitN2Oritented`
    var forwardVisitor = oriented ? visitN1Oriented : visitN1;
    var reverseVisitor = oriented ? visitN2Oriented : visitN2;

    // Maps nodeId to NBASearchState.
    var nodeState = new Map();

    // These two heaps store nodes by their underestimated values.
    var open1Set = new NodeHeap({
      compare: defaultSettings.compareF1Score,
      setNodeId: defaultSettings.setH1
    });
    var open2Set = new NodeHeap({
      compare: defaultSettings.compareF2Score,
      setNodeId: defaultSettings.setH2
    });

    // This is where both searches will meet.
    var minNode;

    // The smallest path length seen so far is stored here:
    var lMin = Number.POSITIVE_INFINITY;

    // We start by putting start/end nodes to the corresponding heaps
    // If variable names like `f1`, `g1` are too confusing, please refer
    // to makeNBASearchStatePool.js file, which has detailed description.
    var startNode = pool.createNewState(from);
    nodeState.set(fromId, startNode); 
    startNode.g1 = 0;
    var f1 = heuristic(from, to);
    startNode.f1 = f1;
    open1Set.push(startNode);

    var endNode = pool.createNewState(to);
    nodeState.set(toId, endNode);
    endNode.g2 = 0;
    var f2 = f1; // they should agree originally
    endNode.f2 = f2;
    open2Set.push(endNode)

    // the `cameFrom` variable is accessed by both searches, so that we can store parents.
    var cameFrom;

    // this is the main algorithm loop:
    while (open2Set.length && open1Set.length) {
      if (open1Set.length < open2Set.length) {
        forwardSearch();
      } else {
        reverseSearch();
      }

      if (quitFast && minNode) break;
    }

    var path = reconstructPath(minNode);
    return path; // the public API is over

    function forwardSearch() {
      cameFrom = open1Set.pop();
      if (cameFrom.closed) {
        return;
      }

      cameFrom.closed = true;

      if (cameFrom.f1 < lMin && (cameFrom.g1 + f2 - heuristic(from, cameFrom.node)) < lMin) {
        graph.forEachLinkedNode(cameFrom.node.id, forwardVisitor);
      }

      if (open1Set.length > 0) {
        // this will be used in reverse search
        f1 = open1Set.peek().f1;
      } 
    }

    function reverseSearch() {
      cameFrom = open2Set.pop();
      if (cameFrom.closed) {
        return;
      }
      cameFrom.closed = true;

      if (cameFrom.f2 < lMin && (cameFrom.g2 + f1 - heuristic(cameFrom.node, to)) < lMin) {
        graph.forEachLinkedNode(cameFrom.node.id, reverseVisitor);
      }

      if (open2Set.length > 0) {
        // this will be used in forward search
        f2 = open2Set.peek().f2;
      }
    }

    function visitN1(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) return;

      var tentativeDistance = cameFrom.g1 + distance(cameFrom.node, otherNode, link);

      if (tentativeDistance < otherSearchState.g1) {
        otherSearchState.g1 = tentativeDistance;
        otherSearchState.f1 = tentativeDistance + heuristic(otherSearchState.node, to);
        otherSearchState.p1 = cameFrom;
        if (otherSearchState.h1 < 0) {
          open1Set.push(otherSearchState);
        } else {
          open1Set.updateItem(otherSearchState.h1);
        }
      }
      var potentialMin = otherSearchState.g1 + otherSearchState.g2;
      if (potentialMin < lMin) { 
        lMin = potentialMin;
        minNode = otherSearchState;
      }
    }

    function visitN2(otherNode, link) {
      var otherSearchState = nodeState.get(otherNode.id);
      if (!otherSearchState) {
        otherSearchState = pool.createNewState(otherNode);
        nodeState.set(otherNode.id, otherSearchState);
      }

      if (otherSearchState.closed) return;

      var tentativeDistance = cameFrom.g2 + distance(cameFrom.node, otherNode, link);

      if (tentativeDistance < otherSearchState.g2) {
        otherSearchState.g2 = tentativeDistance;
        otherSearchState.f2 = tentativeDistance + heuristic(from, otherSearchState.node);
        otherSearchState.p2 = cameFrom;
        if (otherSearchState.h2 < 0) {
          open2Set.push(otherSearchState);
        } else {
          open2Set.updateItem(otherSearchState.h2);
        }
      }
      var potentialMin = otherSearchState.g1 + otherSearchState.g2;
      if (potentialMin < lMin) {
        lMin = potentialMin;
        minNode = otherSearchState;
      }
    }

    function visitN2Oriented(otherNode, link) {
      // we are going backwards, graph needs to be reversed. 
      if (link.toId === cameFrom.node.id) return visitN2(otherNode, link);
    }
    function visitN1Oriented(otherNode, link) {
      // this is forward direction, so we should be coming FROM:
      if (link.fromId === cameFrom.node.id) return visitN1(otherNode, link);
    }
  }
}

function reconstructPath(searchState) {
  if (!searchState) return NO_PATH;

  var path = [searchState.node];
  var parent = searchState.p1;

  while (parent) {
    path.push(parent.node);
    parent = parent.p1;
  }

  var child = searchState.p2;

  while (child) {
    path.unshift(child.node);
    child = child.p2;
  }
  return path;
}

},{"../NodeHeap":7,"../defaultSettings.js":10,"../heuristics":11,"./makeNBASearchStatePool.js":14}],14:[function(require,module,exports){
module.exports = makeNBASearchStatePool;

/**
 * Creates new instance of NBASearchState. The instance stores information
 * about search state, and is used by NBA* algorithm.
 *
 * @param {Object} node - original graph node
 */
function NBASearchState(node) {
  /**
   * Original graph node.
   */
  this.node = node;

  /**
   * Parent of this node in forward search
   */
  this.p1 = null;

  /**
   * Parent of this node in reverse search
   */
  this.p2 = null;

  /**
   * If this is set to true, then the node was already processed
   * and we should not touch it anymore.
   */
  this.closed = false;

  /**
   * Actual distance from this node to its parent in forward search
   */
  this.g1 = Number.POSITIVE_INFINITY;

  /**
   * Actual distance from this node to its parent in reverse search
   */
  this.g2 = Number.POSITIVE_INFINITY;


  /**
   * Underestimated distance from this node to the path-finding source.
   */
  this.f1 = Number.POSITIVE_INFINITY;

  /**
   * Underestimated distance from this node to the path-finding target.
   */
  this.f2 = Number.POSITIVE_INFINITY;

  // used to reconstruct heap when fScore is updated. TODO: do I need them both?

  /**
   * Index of this node in the forward heap.
   */
  this.h1 = -1;

  /**
   * Index of this node in the reverse heap.
   */
  this.h2 = -1;
}

/**
 * As path-finding is memory-intensive process, we want to reduce pressure on
 * garbage collector. This class helps us to recycle path-finding nodes and significantly
 * reduces the search time (~20% faster than without it).
 */
function makeNBASearchStatePool() {
  var currentInCache = 0;
  var nodeCache = [];

  return {
    /**
     * Creates a new NBASearchState instance
     */
    createNewState: createNewState,

    /**
     * Marks all created instances available for recycling.
     */
    reset: reset
  };

  function reset() {
    currentInCache = 0;
  }

  function createNewState(node) {
    var cached = nodeCache[currentInCache];
    if (cached) {
      // TODO: This almost duplicates constructor code. Not sure if
      // it would impact performance if I move this code into a function
      cached.node = node;

      // How we came to this node?
      cached.p1 = null;
      cached.p2 = null;

      cached.closed = false;

      cached.g1 = Number.POSITIVE_INFINITY;
      cached.g2 = Number.POSITIVE_INFINITY;
      cached.f1 = Number.POSITIVE_INFINITY;
      cached.f2 = Number.POSITIVE_INFINITY;

      // used to reconstruct heap when fScore is updated.
      cached.h1 = -1;
      cached.h2 = -1;
    } else {
      cached = new NBASearchState(node);
      nodeCache[currentInCache] = cached;
    }
    currentInCache++;
    return cached;
  }
}

},{}],15:[function(require,module,exports){
module.exports = {
  aStar: require('./a-star/a-star.js'),
  aGreedy: require('./a-star/a-greedy-star'),
  nba: require('./a-star/nba/index.js'),
}

},{"./a-star/a-greedy-star":8,"./a-star/a-star.js":9,"./a-star/nba/index.js":13}],16:[function(require,module,exports){
module.exports = random;

// TODO: Deprecate?
module.exports.random = random,
module.exports.randomIterator = randomIterator

/**
 * Creates seeded PRNG with two methods:
 *   next() and nextDouble()
 */
function random(inputSeed) {
  var seed = typeof inputSeed === 'number' ? inputSeed : (+new Date());
  return new Generator(seed)
}

function Generator(seed) {
  this.seed = seed;
}

/**
  * Generates random integer number in the range from 0 (inclusive) to maxValue (exclusive)
  *
  * @param maxValue Number REQUIRED. Omitting this number will result in NaN values from PRNG.
  */
Generator.prototype.next = next;

/**
  * Generates random double number in the range from 0 (inclusive) to 1 (exclusive)
  * This function is the same as Math.random() (except that it could be seeded)
  */
Generator.prototype.nextDouble = nextDouble;

/**
 * Returns a random real number uniformly in [0, 1)
 */
Generator.prototype.uniform = nextDouble;

Generator.prototype.gaussian = gaussian;

function gaussian() {
  // use the polar form of the Box-Muller transform
  // based on https://introcs.cs.princeton.edu/java/23recursion/StdRandom.java
  var r, x, y;
  do {
    x = this.nextDouble() * 2 - 1;
    y = this.nextDouble() * 2 - 1;
    r = x * x + y * y;
  } while (r >= 1 || r === 0);

  return x * Math.sqrt(-2 * Math.log(r)/r);
}

function nextDouble() {
  var seed = this.seed;
  // Robert Jenkins' 32 bit integer hash function.
  seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
  seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
  seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
  seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff;
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
  this.seed = seed;
  return (seed & 0xfffffff) / 0x10000000;
}

function next(maxValue) {
  return Math.floor(this.nextDouble() * maxValue);
}

/*
 * Creates iterator over array, which returns items of array in random order
 * Time complexity is guaranteed to be O(n);
 */
function randomIterator(array, customRandom) {
  var localRandom = customRandom || random();
  if (typeof localRandom.next !== 'function') {
    throw new Error('customRandom does not match expected API: next() function is missing');
  }

  return {
    forEach: forEach,

    /**
     * Shuffles array randomly, in place.
     */
    shuffle: shuffle
  };

  function shuffle() {
    var i, j, t;
    for (i = array.length - 1; i > 0; --i) {
      j = localRandom.next(i + 1); // i inclusive
      t = array[j];
      array[j] = array[i];
      array[i] = t;
    }

    return array;
  }

  function forEach(callback) {
    var i, j, t;
    for (i = array.length - 1; i > 0; --i) {
      j = localRandom.next(i + 1); // i inclusive
      t = array[j];
      array[j] = array[i];
      array[i] = t;

      callback(t);
    }

    if (array.length) {
      callback(array[0]);
    }
  }
}
},{}]},{},[1])(1)
});
