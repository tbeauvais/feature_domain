
angular.module('sampleDomainApp').factory 'FeatureNames',  ->

  ['TextFeature', 'LinkFeature', 'ImageFeature', 'ListFeature', 'HeaderFeature', 'ContainerFeature']


angular.module('sampleDomainApp').factory 'Features', ($injector, FeatureNames) ->

  featureList = {}

  for name in FeatureNames
    # Lookup from factory using feature name
    feature = $injector.get(name)
    featureList[name] = feature

  getFeature: (name) ->
    featureList[name]

  getFeatures:  ->
    featureList

  createFeatureInstance: (name) ->
    feature = featureList[name]
    featureInstance = { feature: name, id: '9', template: ''}
    inputs = {}
    for input in feature.inputs
      if input.name != 'page_location'
        inputs[input.name] = ''
      else
        inputs[input.name] = {name: 'Page 1', target: '#content_section'}

    featureInstance['inputs'] = inputs
    featureInstance

angular.module('sampleDomainApp').factory 'TextFeature', (AppMetadata) ->

  name: 'Text'
  icon: 'glyphicon-pencil'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs) ->
    AppMetadata.add_target('Page 1', instance.id)
    $(inputs.page_location.target).append("<div id='#{instance.id}' title='generated from #{instance.name}' >#{inputs.text}</div>")


angular.module('sampleDomainApp').factory 'ContainerFeature', (AppMetadata) ->

  name: 'Container'
  icon: 'glyphicon-th'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'columns'
    label: 'Columns'
    type: 'string'
  ,
    name: 'rows'
    label: 'Rows'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs) ->

    columns = parseInt(inputs.columns)
    columns = 12 if columns > 12
    col_size = 12/columns

    rows = parseInt(inputs.rows)

    $rows = $('<div/>', {class: 'container-fluid', id: instance.id})

    row = 0
    while row < rows
      row += 1

      $row = $('<div/>', {class: 'row'})
      $rows.append($row)

      col = 0
      while col < columns
        col += 1
        id = "container_row_#{row}_col_#{col}"
        $row.append($('<div/>', {class: "col-md-#{col_size}", id: id}))
        AppMetadata.add_target('Page 1', '#' + id)

    $(inputs.page_location.target).append($rows)


angular.module('sampleDomainApp').factory 'HeaderFeature', (AppMetadata) ->

  name: 'Header'
  icon: 'glyphicon-header'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
  ,
    name: 'size'
    label: 'Size'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs) ->
    AppMetadata.add_target('Page 1', instance.id)
    $(inputs.page_location.target).append("<H#{inputs.size} id='#{instance.id}' title='generated from #{instance.name}' >#{inputs.text}</H#{inputs.size}>")


angular.module('sampleDomainApp').factory 'ListFeature', (AppMetadata) ->

  name: 'List'
  icon: 'glyphicon-list'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'list'
    label: 'List Items'
    placeholder: 'Comma separated list'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs, scope) ->
    AppMetadata.add_target('Page 1', instance.id)
    listName = "list_#{instance.id}"
    scope[listName] = inputs.list.split(',')
    $(inputs.page_location.target).append("<ul id='#{instance.id}'><li ng-repeat='item in #{listName}'>{{item}}</li></ul>")


angular.module('sampleDomainApp').factory 'LinkFeature', (AppMetadata) ->

  name: 'Link'
  icon: 'glyphicon-link'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'href'
    label: 'Link URL'
    placeholder: 'http://www.google.com'
    type: 'string'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs) ->
    AppMetadata.add_target('Page 1', instance.id)
    $(inputs.page_location.target).append("<div id='#{instance.id}'><a href='#{inputs.href}' target='_blank'>#{inputs.text}</a></div>")


angular.module('sampleDomainApp').factory 'ImageFeature', (AppMetadata) ->

  name: 'Image'
  icon: 'glyphicon-picture'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'src'
    label: 'Image URL'
    placeholder: 'http://a-z-animals.com/capybara3.jpg'
    type: 'string'
  ,
    name: 'alt'
    label: 'Alt Text'
    type: 'string'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  generate: (instance, inputs) ->
    AppMetadata.add_target('Page 1', instance.id)
    $(inputs.page_location.target).append("<image id='#{instance.id}' src='#{inputs.src}' alt='#{inputs.alt}'  height='#{inputs.height}' width='#{inputs.width}'>")


