+++
title = "Habit@weave Java AAL app"
description = "Habit@weave is a web application for the control and monitoring smart homes and wearable devices"
tags = [ "openshift", "Java", "cloud", "application" ]
date = "2015-08-18"
categories = [
  "Java",
  "cloud"
]
slug = "Habit@weave-Java-application-for-OpenShift"
url = "/post/Habit@weave-Java-application-for-OpenShift/"
+++

OpenShift is Red Hat's Platform-as-a-Service (PaaS) that allows developers to quickly develop, host, and scale applications in a cloud environment. It has decent documentation and relatively steep learning curve. It also provides free hosting + free MySQL DB up to 1 GB, which is aweosome!

After installing `Ruby` and `RHC` - Openshift's client tool, by following [these](https://developers.openshift.com/en/getting-started-overview.html) steps, you can start creating a Java web application following [these](https://developers.openshift.com/en/tomcat-getting-started.html) steps.


# Habit@weave

Habit@weave is a web application for the control and monitoring smart homes and wearable devices.
The power consumption graphs and the capability to schedule actions can help the user to make the right decisions for efficient energy saving at home, while the calorie consumption and sleep quality charts may contribute to adoption of habits that improve heath. The user can use the application from a PC, as well as from any other portable device with access to the Internet. It is an initial effort towards a functional Ambient Assisted Living system.
It's also a good starting point for any Java web application with Hibernate JPA and Shiro security frameworks.

## Demo

A demo of the application's runs here [http://habitat-atsamour.rhcloud.com](http://habitat-atsamour.rhcloud.com).
To try the application use these credentials:

* E-mail: `test2@gmail.com`
* Password: `1234`


## Source

The application's git repo is [here](https://github.com/atsamour/Habit-at-weave_openshift-MySQL).
You can find the sample database used in the application at the [amazon cloud](https://s3-eu-west-1.amazonaws.com/atsamourfiles/awesomedb(openshift-MySQL-5.5).zip) (add a database named `awesomedb` to the OpenShift MySQL Cartridge and import tables there).

The folders are organized as a Maven project. Backend is written in Java using javax.servlet API, frontend is based on Bootstrap and implemented with JSP views.


![Screenshot](http://s4.postimg.org/7sibz1n4d/image.png)
![Screenshot](http://s13.postimg.org/ryipgphmv/sleep.png)
![Screenshot](http://s27.postimg.org/mm701vq3n/activity.png)
