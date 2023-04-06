# MDN Web Data

This package exposes easy to use Web Platform documentation and compatibility data.

It contains information about each and every Web feature that's documented on MDN. This includes CSS properties or selectors, HTML tags or attributes, or even JavaScript language features or APIs.

The data comes from the following repositories:

* [mdn/content](https://github.com/mdn/content):

  This repository is used to extract the description for each and every Web feature contained in this package.

* [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data):

  This repository is used to extract browser compatibility data for each Web Platform feature.

* [mdn/data](https://github.com/mdn/data):

  This repository is used to extract CSS syntax data.

## Usage

Install the package:

```bash
npm install mdn-web-data
```

Use the data:

```js
import mdnWebData from "mdn-web-data";

console.log(mdnWebData.css.property.margin.summary);
```
