# elevation

This script renders roads with different colors based on elevation level above the sea. The data comes from
[MapBox](https://blog.mapbox.com/global-elevation-data-6689f1d0ba65).

It is part of the growing collection of scripts for the city roads website. [See more scripts here](https://github.com/anvaka/city-script#city-script);

## usage

To initialize the script, load a city, then open [developer tools](https://support.airtable.com/hc/en-us/articles/232313848-How-to-open-the-developer-console) in your browser and then type:

``` js
let city = await requireModule('city-script');
let d = await city.elevation(scene);
```

Wait a few seconds and the elevation api should be ready.

## d.drawWithHeight(height: number, color?: 0xRRGGBBAA)

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

## d.drawWithColor(getColorCallback: Function(elevation): color)

If two colors is not enough for your use case and you need more control over coloring, use
`d.drawWithColor()` API. You can pass it a function, which takes elevation level above the sea,
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
