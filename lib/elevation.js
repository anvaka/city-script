const MAPBOX_TOKEN = 'pk.eyJ1IjoiYW52YWthIiwiYSI6ImNqaWUzZmhqYzA1OXMza213YXh2ZzdnOWcifQ.t5yext53zn1c9Ixd7Y41Dw';
const apiURL = `https://api.mapbox.com/v4/mapbox.terrain-rgb/zoom/tLong/tLat@2x.pngraw?access_token=${MAPBOX_TOKEN}`;
const tileSize = 512;
let imageCache = new Map();

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
  let zoomLevel, sw, se, ne, nw;
  for (let z = 0; z < 12; ++z) {
    sw = pointToTile(bounds.west, bounds.south, z);
    se = pointToTile(bounds.east, bounds.south, z);
    ne = pointToTile(bounds.east, bounds.north, z);
    nw = pointToTile(bounds.west, bounds.north, z);
    if (!same(sw, se) || !same(se, ne) || !same(ne, nw)) {
      zoomLevel = z;
      break;
    }
  }

  zoomLevel += 1;
  sw = pointToTile(bounds.west, bounds.south, zoomLevel);
  se = pointToTile(bounds.east, bounds.south, zoomLevel);
  ne = pointToTile(bounds.east, bounds.north, zoomLevel);
  nw = pointToTile(bounds.west, bounds.north, zoomLevel);
  let minX = Math.min(sw[0], nw[0]);
  let minY = Math.min(ne[1], nw[1]);
  let maxX = Math.max(se[0], ne[0]);
  let maxY = Math.max(se[1], sw[1]);
  return {
    minX, minY, maxY, maxX, zoomLevel
  };
}

function same(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; ++i) {
    if (arr1[i] !== arr2[i]) return false;
  }

  return true;
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

  const canvas = document.createElement("canvas");
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

// The following bit is from 
// https://github.com/mapbox/tilebelt/blob/master/index.js
// (C) The MIT License (MIT)
// Copyright (c) 2014 Morgan Herlocker
function pointToTile(lon, lat, z) {
    var tile = pointToTileFraction(lon, lat, z);
    tile[0] = Math.floor(tile[0]);
    tile[1] = Math.floor(tile[1]);
    return tile;
}

function pointToTileFraction(lon, lat, z) {
  var d2r = Math.PI / 180;
  var sin = Math.sin(lat * d2r),
      z2 = Math.pow(2, z),
      x = z2 * (lon / 360 + 0.5),
      y = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

    // Wrap Tile X
    x = x % z2
    if (x < 0) x = x + z2
    return [x, y, z];
}
