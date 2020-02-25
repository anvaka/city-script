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