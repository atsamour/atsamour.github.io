+++
title = "Hugo web-site engine"
description = "This site is built with Hugo static site engine. Find out more about it."
tags = [ "Hugo", "Go", "web"]
date = "2015-08-22"
categories = [
  "web"
]
slug = "Hugo-this-site's-engine"
url = "/post/Hugo-this-site's-engine/"
+++

## What's Hugo?

[Hugo](https://gohugo.io/) introduces itself as a "Fast & modern static site engine", with the aim to make the web fun again. After ages of CGI scripts evolution, easy and attractive CMSes, it looks like static page are back in fashion. Initially made popular by [Jekyll](http://jekyllrb.com/) a couple of years before, Hugo is one of the last additions to the family.
It's [open source](https://github.com/spf13/hugo), written in [Go](http://golang.org/), with a handful of [themes](https://github.com/spf13/hugoThemes), it's easy to install and use.


### Writing content

Apart from content – appearance distinction with an excellent theme system, hugo also supports easy metadata integration. These info is included in the very same file with the content to be market in a toml, yaml or json format, as described in hugo’s great [documentation]( http://gohugo.io/content/front-matter).
The content itself can be written in some of the supported formats, for which the documentation links us straight to Hugo's [source](https://github.com/spf13/hugo/blob/77c60a3440806067109347d04eb5368b65ea0fe8/helpers/general.go#L65)
	
	// GuessType attempts to guess the type of file from a given string.
	func GuessType(in string) string {
		switch strings.ToLower(in) {
			case "md", "markdown", "mdown":
				return "markdown"
			case "asciidoc", "adoc", "ad":
				return "asciidoc"
			case "mmark":
				return "mmark"
			case "rst":
				return "rst"
			case "html", "htm":
				return "html"
		}
		return "unknown"
	}

Hugo then utilizes [Blackfriday](https://github.com/russross/blackfriday) to convert source content file to HTML. More inf on supported formatting is available at `Markdown` creator's site: [http://daringfireball.net/projects/markdown/syntax](http://daringfireball.net/projects/markdown/syntax) or here: [https://help.github.com/articles/markdown-basics/](https://help.github.com/articles/markdown-basics/). If you're not sure about the outcome of your source, just try it [here](http://daringfireball.net/projects/markdown/dingus) before compiling it with Hugo.


#### To run

After installing Hugo, writing your content and setting up a theme just type `hugo -D -t theme-name` and your site is generated in seconds (or even less) in the /public folder. It is ready to be uploaded.


