# orientation

This script renders a polar histogram of roads orientation within any city. The size of the
bar in this histogram shows total length of roads in the direction of the bar.
[See more scripts here](https://github.com/anvaka/city-script#city-script);

## usage

To initialize it, load a city in the [city-roads](https://anvaka.github.io/city-roads/), and 
enter the following command in the [developer console](https://developers.google.com/web/tools/chrome-devtools/open).

``` js
let city = await requireModule('city-script');
```

The `city` object is your access point to all the scripts in the current repository.

## city.orientation(options?)

``` js
city.orientation();
```

This will render a default histogram:

![default histogram](https://i.imgur.com/BS5LGRz.png)

Once the histogram is loaded, you can click on it. When border is dotted - you can drag it around.
When border is solid - you can click on any area in the circle, to highlight matching roads.

Holding `shift` key adds slices to collection. Holding `alt` key inverts the selection. You can then 
open `customize` window to hide original roads or change colors. Here is how Seattle looks like if you
remove all South-North and East-West roads:

![no major roads](https://i.imgur.com/3x9fvLF.png)

## API
You can control stroke width and color:

``` js
city.orientation({
  strokeWidth: 2,        // make borders thicker
  strokeColor: '#2288ff' // and make them blue
});
```

![stroke control](https://i.imgur.com/Ld47yRN.png)

To adjust the radius of the inner circle, pass the `r` variable:

``` js
city.orientation({
  r: 80 // The inner circle radius 
})
```

![inner circle radius](https://i.imgur.com/tkxOuCx.png)

To change the width of the outer circle, pass the `width` variable:

``` js
city.orientation({
  width: 84 // The outer circle width
})
```

![outer circle width](https://i.imgur.com/YrM1KlI.png)

Finally, to change number of buckets, pass the `count` variable:

``` js
city.orientation({
  count: 42
})
```

![count of buckets](https://i.imgur.com/KXyAjxs.png)