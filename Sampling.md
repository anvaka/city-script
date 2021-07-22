# Sampling

This script samples `N` nodes from the graph, and assigns nearest neighbors to the sampled
nodes using color. Nodes are sampled based on either longest shortest distance between
all previously sampled nodes or with probably proportional to the shortest distance.
[See more scripts here](https://github.com/anvaka/city-script#city-script)

## usage

To initialize it, load a city in the [city-roads](https://anvaka.github.io/city-roads/), and 
enter the following command in the [developer console](https://developers.google.com/web/tools/chrome-devtools/open).

``` js
let city = await requireModule('city-script');
```

The `city` object is your access point to all the scripts in the current repository.

## city.splitToParts(partsCount, options?)

``` js
city.splitToParts(3);
```

This will split a city into 3 parts:

![3 parts](https://i.imgur.com/2tWYSW1.png)

## like what you see?

Play with your city here: https://anvaka.github.io/city-roads