# city-script

Collection of scripts that can be loaded into city-roads

## Usage

Load a city in https://anvaka.github.io/city-roads/, and then [open developer console](https://developers.google.com/web/tools/chrome-devtools/open).

In the console, type the following command to load the city scripts from this repository:

``` js
let city = await requireModule('city-script');
```

The `city` object is your access point to all the scripts in the current repository. While
I hope to add more scripts here, right now only one script is available.

### findPaths(scene, options?)

This script searches for a shortest paths in the loaded city. To execute it, simply enter the following
command:

``` js
city.findPaths(scene);
```

This will clear the scene, and will perform search of the shortest paths between 2,000 random
points in the city. It will print the progress onto console.

Once you get the basic feel of the script, you can explore more options.

#### Single source shortest paths

You can pick any location in the city, and visualize shortest paths from it to arbitrary 2,000
points:

``` js
city.findPaths(scene, {
  from: { lat: 47.8167059, lon: -122.3293886 }
})
```

Note: You can use google maps to find [the lon/lat values](https://www.clubrunnersupport.com/article/1416-how-to-find-a-location-s-latitude-longitude-in-google-maps) of any place.

#### Configuring count of shortest paths

If 2,000 is too much/too little for your city, you can adjust it:

``` js
city.findPaths(scene, {
  count: 10000, // Show 10,000 shortest paths to collect
  from: { lat: 47.8167059, lon: -122.3293886 }
})
```

#### Side by side rendering

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

#### Pro tips

* When visualizing multiple shortest paths, adjust the alpha value of the lines color to something
very small. 0.05 or even less would result in a nice, flame like tree. The alpha value can
be adjusted using regular color picker for the lines.
* Finding shortest paths is an intensive CPU task, during this period of time, the website maybe a
bit lagging - I'm sorry about this!
* Once visualization is done, you can still export it as a PNG image, onto a mug, or even as vector file!
One caveat for the vector files: the alpha transparency is not preserved there.

### await elevation(scene, options?)

This script renders roads with different colors based on elevation level above the sea. The data comes from
[MapBox](https://blog.mapbox.com/global-elevation-data-6689f1d0ba65).

To initialize the script, load a city, then open [developer tools](https://support.airtable.com/hc/en-us/articles/232313848-How-to-open-the-developer-console) in your browser and then type:

``` js
let city = await requireModule('city-script');
let d = await elevation(scene);
```

These commands will load the `city script` and elevation data Wait a few seconds and the elevation api should be ready.

#### drawWithHeight(height:number, color?: 0xRRGGBBAA)

Now the the scripts is loaded, let's try a few things:

``` js
// this will render all roads below 20m of the sea level with red color
d.drawWithHeight(20); 

// if you don't like the default color, you can change it.
// Let's render them blue:
d.drawWithHeight(20, 0x0000ffff); 
```

The `color` is a hexadecimal 4-byte number, where every byte represents color
value in RGBA schema. For example:

```
d.drawWithHeight(20, 0xff0000ff); // red
d.drawWithHeight(20, 0x00ff00ff); // green
d.drawWithHeight(20, 0x0000ffff); // blue
d.drawWithHeight(20, 0x000000ff); // black
d.drawWithHeight(20, 0xffffffff); // white
d.drawWithHeight(20, 0xffffff7f); // white, with 50% opacity
d.drawWithHeight(20, 0x00000000); // fully transparent (invisible)
d.drawWithHeight(20, 0); // Same as above - fully transparent (invisible)
```

#### drawWithColor(getColorCallback: Function(elevation): color)

If two colors is not enough for your use case and you need more control over coloring, use
`.drawWithColor()` API. You can pass it a function, which takes elevation level above the sea,
and should return a hexadecimal color value (same as `drawWithHeight()`). For example:

``` js
// This will color all roads under 110m as blue (0x0000ffff),
// all roads under 140m as red (0xff0000ff)
// and black (0x000000ff) for all other cases:
d.drawWithColor(elevation => {
  if (elevation < 110) return 0x0000ffff;
  if (elevation < 140) return 0xff0000ff;
  return 0x000000ff;
});
```

## More scripts

I hope to add more scripts. If you have requests - please do not hesitate to open [issue here](https://github.com/anvaka/city-script/issues), or [ping me on twitter](https://twitter.com/anvaka).

If you are a software engineer and would like to build the scripts too - you are more than welcome to
explore the [source code](https://github.com/anvaka/city-script/blob/master/lib/findPaths.js).

I'm slowly updating documentation for the most major modules used by the city-roads, and if you don't
want to wait or need some ideas how to do `X` (where `X` is your own passion/idea) - please ping me. I love data
visualizations and would be glad to help.

# Support

Your support is more than welcomed! More than anything it sends me a strong signal that I'm doing
something useful, that the time is not wasted, and someone finds this valuable. Please 
[be my sponsor](https://github.com/sponsors/anvaka) if you love this work.