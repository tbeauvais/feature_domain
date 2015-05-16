Feature Based Application Generation
==============

Sample feature based domain for constructing an application with data service and content rendering.

# Highlevel Architecture

![Application Architecture](/doc/AppArchitecture.jpg)

(c) Thomas Beauvais 2014 All Rights Reserved.
No part of this document or any of its contents may be reproduced, copied, modified or adapted, without the prior written consent of the author, unless otherwise indicated.

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
