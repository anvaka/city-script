# findPaths

This script searches for a shortest paths in the loaded city. It is part of the growing collection
of scripts for the city roads website. [See more scripts here](https://github.com/anvaka/city-script#city-script);

## usage

To initialize it, load a city in the [city-roads](https://anvaka.github.io/city-roads/), and 
enter the following command in the [developer console](https://developers.google.com/web/tools/chrome-devtools/open).

``` js
let city = await requireModule('city-script');
```

The `city` object is your access point to all the scripts in the current repository.

## city.findPaths(scene, options?)

``` js
city.findPaths(scene);
```

This will clear the scene, and will perform search of the shortest paths between 2,000 random
points in the city. It will print the progress onto console.

Once you get the basic feel of the script, you can explore more options.

## Single source shortest paths

You can pick any location in the city, and visualize shortest paths from it to arbitrary 2,000
points:

``` js
city.findPaths(scene, {
  from: { lat: 47.8167059, lon: -122.3293886 }
})
```

Note: You can use google maps to find [the lon/lat values](https://www.clubrunnersupport.com/article/1416-how-to-find-a-location-s-latitude-longitude-in-google-maps) of any place.

## Configuring count of shortest paths

If 2,000 is too much/too little for your city, you can adjust it:

``` js
city.findPaths(scene, {
  count: 10000, // Show 10,000 shortest paths to collect
  from: { lat: 47.8167059, lon: -122.3293886 }
})
```

## Side by side rendering

By default this script clears the entire scene before it starts the visualization.
If you prefer to render shortest paths along with the original city, do the following:

``` js
// Let's kick of the shortest paths computation: 
let paths = city.findPaths(scene, {
  keepScene: true,
  from: { lat: 47.8167059, lon: -122.3293886 }
});

// and move paths to the left of the original city
paths.lines.translate([/* x = */ 10000, /* y = */ 0, /* z = */ 0]); 
```

## Pro tips

* When visualizing multiple shortest paths, adjust the alpha value of the lines color to something
very small. 0.05 or even less would result in a nice, flame like tree. The alpha value can
be adjusted using regular color picker for the lines.
* Finding shortest paths is an intensive CPU task, during this period of time, the website maybe a
bit lagging - I'm sorry about this!
* Once visualization is done, you can still export it as a PNG image, onto a mug, or even as vector file!
One caveat for the vector files: the alpha transparency is not preserved there.
