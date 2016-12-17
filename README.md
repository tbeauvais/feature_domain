Feature Based Application Generation
==============

Sample feature based domain for constructing an application with data service and content rendering.

# Highlevel Architecture

![Application Architecture](/doc/AppArchitecture.jpg)

(c) Thomas Beauvais 2014 All Rights Reserved.
No part of this document or any of its contents may be reproduced, copied, modified or adapted, without the prior written consent of the author, unless otherwise indicated.


Points
* Feature Based
* Feature Instance Metadata (what a feature generated, and it’s relationships)
* Visual and non-visual editors (enables mobile editing)
* Data Resources (Swagger/REST Services)
* Data Rendering (Table, graph)
* Partial generation after edit (Google map)
* Composite Features
* Drag within container sets target page location
* Can be extended to server side microservice generation


# What is a Feature
A Feature provides a unit of work that participates with other features in the construction of a generated application. A Feature can work independantly or in concert with other Features. 

Features do one or more of the following: 

* Add artifacts to the application
* Modify an existing artifact
* Add metadata related to its activity
* Invoke other Features 
* Driven by their inputs (parameters)
* Provide low level functionality such as a button
* Provide high-level functionality such as a editable table

## Feature Inputs
Feature inputs allow the feature to be parameterized. Inputs are feed into a feature instance an allow it to drive its variability  

For example here are the inputs for a simple Text feature.
```
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
    default: 'untitled'
    control: 'text-input'
  ,
    name: 'disable'
    label: 'Disable'
    type: 'boolean'
    defaut: 'false'
    control: 'checkbox-input'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit'
    control: 'text-input'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'object'
    properties:
      target:
        description: "Target page location"
        type: 'string'
      name:
        description: "Page name"
        type: 'string'
    control: 'page-target-selector'
  ]

```

## Feature Generation
Exach feature specifies a generate function, which has access to the current state of the application metadata, inputs, and its instance information.

For example here is the generate function for a simple Text feature.
```
  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.append("<span>#{inputs.text}</span>")
      true
    else
      false
```

# Application Model
The application model contains the model ID, Name, and specifies a collection of feature instances. Each feature instance contains only the inputs that are used to drive the Feature.

A feature instance in the application model contains the following:
* Feature ID
* Feature instance ID
* Feature instance inputs
* Feature instance Cache


```
{
  "id": "dc18f291-be60-41fa-911e-149e0afce4c8",
  "name": "Data Sample",
  "features": [
    {
      "feature": "PageFeature",
      "id": "15",
      "inputs": {
        "name": "Page",
        "text": "",
        "page_location": {
          "name": "Page 1",
          "target": "#content_section"
        },
        "border_color": "#00a3ff",
        "background_color": "#e6fcfc",
        "background_image": ""
      },
      "cache": {}
    },
    {
      "feature": "ImageFeature",
      "id": "25",
      "inputs": {
        "name": "header image",
        "disable": false,
        "src": "http://www.baybridgecompanies.com/clipart/pageHeaders/blue_header.jpg",
        "alt": "some cool image",
        "height": "150",
        "width": "100%",
        "align": "center-block",
        "page_location": {
          "target": "#page_container",
          "name": "Page 1"
        },
        "responsive": false
      },
      "cache": {}
    },
    {
      "feature": "SeparatorFeature",
      "id": "27",
      "inputs": {
        "name": "Separator",
        "disable": false,
        "align": "center",
        "page_location": {
          "target": "#page_container",
          "name": "Page 1"
        },
        "color": "#2fa7eb",
        "width": "80",
        "height": "5"
      },
      "cache": {}
    },
  ......
  ]
}
```

# Application Metadata
The application metadata is used to publish information related to feature instances. The feature metadata can be used at generation time by other features to introspect information about the application under construction, and at design time to enhance the visual or feature input pages. The application metadata is transient.

# License
Released under the MIT license.
