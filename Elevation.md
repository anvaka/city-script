# elevation

This script renders roads with different colors based on elevation level above the sea. The data comes from
[MapBox](https://blog.mapbox.com/global-elevation-data-6689f1d0ba65).

It is part of the growing collection of scripts for the city roads website. [See more scripts here](https://github.com/anvaka/city-script#city-script)

## usage

To initialize the script, load a city, then open [developer tools](https://support.airtable.com/hc/en-us/articles/232313848-How-to-open-the-developer-console) in your browser and then type:

``` js
let city = await requireModule('city-script');
let d = await city.elevation();
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

## d.saveHeightMap(filename: string)

Generate and download a grayscale heightmap image that matches the current viewport. The heightmap provides elevation data as a PNG image where darker pixels represent lower elevations and lighter pixels represent higher elevations.

``` js
// Save a heightmap with default filename
d.saveHeightMap('city-heightmap'); 

// The filename will automatically include the elevation range
// e.g., 'city-heightmap_15m-342m.png'
```

The heightmap has these key features:

- **Perfect SVG alignment**: Dimensions match SVG exports exactly for 1:1 pixel mapping
- **Geographic accuracy**: Each pixel corresponds to real-world coordinates  
- **Elevation encoding**: Grayscale values from 0 (minimum elevation) to 255 (maximum elevation)
- **Automatic naming**: Filename includes the elevation range (e.g., `_15m-342m.png`)
- **Progress logging**: Console shows tile loading and processing progress

This is useful for:
- Creating elevation overlays for other graphics software
- Generating terrain data for 3D modeling
- Analyzing elevation patterns across the city
- Creating custom visualizations with precise elevation data

The heightmap coordinates perfectly align with SVG exports, making it easy to combine elevation data with vector graphics of the road network.

## Animation

This is just an example of how you can make an animation of raising animation. Open developer tools
and paste this code:

``` js
let city = await requireModule('city-script');
let d = await city.elevation();

function doAnimation(options) {
  let min = -1, max = 100, color = 0x0066ffff;
  if (options) {
    if (options.min !== undefined) min = options.min;
    if (options.max !== undefined) max = options.max;
    if (options.color !== undefined) color = options.color;
  }

  let lastHeight = min;
  let name = window.scene.queryLayer().grid.name.split(',')[0];

  frame();

  function frame() {
    lastHeight += 1;  
    document.querySelector('.city-name .printable').innerText = name + ' ' + lastHeight + 'm';
    d.drawWithHeight(lastHeight, color); 

    if (lastHeight < max) requestAnimationFrame(frame);
  }
}

doAnimation({
  min: 0, 
  max: 100,
  color: 0x0066ffff
});
```