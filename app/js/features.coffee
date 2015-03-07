class Features
  constructor: (designMode, appMetadata) ->

    @featureList = {}
    if designMode != false
      designMode = true

    for name, featureClass of FeatureClasses
      @featureList[name] = new featureClass(designMode: designMode, appMetadata: appMetadata)

  getFeature: (name) ->
    @featureList[name]

  getFeatures:  ->
    @featureList

  createFeatureInstance: (name) ->
    # TODO need a better way to do this
    feature = @featureList[name]
    featureInstance = { feature: name, id: '9', template: ''}
    inputs = {}
    for input in feature.inputs
      if input.name != 'page_location'
        inputs[input.name] = input.default || ''
    featureInstance['inputs'] = inputs
    featureInstance


class BaseFeature
  constructor: (initData) ->
    @designMode = initData.designMode

  dragDropSupport: (id) ->
    if @designMode
      "ui-draggable='true' drag='#{id}' drag-channel='B' drop-channel='B,A' ui-on-drop='onDropFromContent($event,$index,$channel,$data,#{id})'"
    else
      ''

  addFeature: (appMetadata, instance, inputs) ->
    feature = {id: instance.id, instance: instance, name: instance.inputs.name}
    appMetadata.addFeature(feature, instance.id)
    feature

  addPageFeature: (appMetadata, instance, inputs, id) ->
    feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: id, page: inputs.page_location.name, target: inputs.page_location.target}}
    appMetadata.addFeature(feature, instance.id)
    appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id)

  instanceId: (instance, inputs) ->
    (inputs.name + '_' + instance.id).replace(/\s+/g, '_').toLowerCase()

  cleanName: (name) ->
    name.replace(/\s+/g, '')

  getTarget: (page_info, id, instanceId) ->
    target = $(page_info.target)
    if target.length > 0
      unless target.attr('id') == id
        dd = @dragDropSupport(instanceId)
        el = $("<div #{dd} id='#{id}' ></div>")
        target.append(el)
        target = el

    target

class DataResourceFeature extends BaseFeature

  name: 'DataResource'
  icon: 'glyphicon-cog'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
    default: 'untitled'
    control: 'text-input'
  ,
    name: 'resource'
    label: 'Resource URL'
    default: 'https://query.yahooapis.com/v1/public/yql?q=select%20item.condition%20from%20weather.forecast%20where%20woeid%20%3D%202415484&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys'
    type: 'string'
    control: 'text-input'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs, scope) ->
    id = @instanceId(instance, inputs)
    @addFeature(appMetadata, instance, inputs)
    appMetadata.addDataResource(inputs.name, inputs.resource, instance.id)
    $.get inputs.resource, (data) =>
      scope.DataResource = {} unless scope.DataResource
      scope.DataResource[@cleanName(inputs.name)] = data


class TableFeature extends BaseFeature

  name: 'Table'
  icon: 'glyphicon-th'
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
    name: 'resource'
    label: 'Data Resource'
    type: 'string'
    default: ''
    control: 'resource-select'
  ,
    name: 'fields'
    label: 'Fields'
    placeholder: 'Comma separated list'
    type: 'string'
    default: ''
    control: 'text-input'
  ,
    name: 'labels'
    label: 'Lables'
    placeholder: 'Comma separated list'
    type: 'string'
    default: ''
    control: 'text-input'
  ,
    name: 'filters'
    label: 'Filters'
    placeholder: 'Comma separated list'
    type: 'string'
    default: ''
    control: 'text-input'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
    control: 'page-target-selector'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      appMetadata.addDataResourceReference(inputs.resource, instance.id)

      headerRow = ''
      labels = []
      labels = inputs.labels.split(',') if inputs.labels

      filters = []
      filters = inputs.filters.split(',') if inputs.filters

      dataRow = ''
      fields = []
      fields = inputs.fields.split(',') if inputs.fields


      for field, index in fields
        filter = ''
        filter = ' | ' + filters[index] if filters[index].length > 0
   #     dataRow += "<td>{{data.#{field}#{filter}}}</td>"
        dataRow += "<td ng-bind-html='data.#{field}#{filter}' ></td>"
        headerRow += "<th>#{labels[index] || field}</th>"

      target.append("<div #{dd} id='#{id}' class='table-responsive' style='background-color: #ffffff'><table class='table table-bordered table-striped' ><tr>#{headerRow}</tr> <tr ng-repeat='data in DataResource.#{inputs.resource}'>#{dataRow}</tr></table></div>")
      true
    else
      false


class PageFeature extends BaseFeature

  name: 'Page'
  icon: 'glyphicon-file'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
    control: 'text-input'
  ,
    name: 'border_color'
    label: 'Border Color'
    type: 'string'
    control: 'color-picker'
  ,
    name: 'background_color'
    label: 'Background Color'
    type: 'string'
    control: 'color-picker'
  ,
    name: 'background_image'
    label: 'Background Image'
    type: 'string'
    control: 'text-input'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
    control: 'page-target-selector'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      appMetadata.addPage('Page 1', 'Page 1')
      appMetadata.addPageTarget('Page 1', '#content_section');
      @addPageFeature(appMetadata, instance, inputs, id)
      appMetadata.addPageTarget('Page 1', '#page_container', '#' + id, instance.id)
      style = ''
      if inputs.border_color
        style = "border: 5px solid #{inputs.border_color};border-radius: 5px;padding: 8px;"
      if inputs.background_color
        style += "background-color: #{inputs.background_color};"
      if inputs.background_image
        style += "background-image: url(#{inputs.background_image});"

      # TODO fix this ID
      target.append("<div style='#{style}' id='page_container' ></div>")
      true
    else
      false


class TextFeature extends BaseFeature

  name: 'Text'
  icon: 'glyphicon-pencil'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'span'
      input: 'text'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.append("<span>#{inputs.text}</span>")
      true
    else
      false


class ButtonFeature extends BaseFeature

  name: 'Button'
  icon: 'glyphicon-link'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'a'
      input: 'text'
    ]
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
    default: 'Click Me'
    control: 'text-input'
  ,
    name: 'href'
    label: 'Target'
    placeholder: 'http://www.google.com'
    type: 'string'
    default: 'http://www.google.com'
    control: 'text-input'
  ,
    name: 'style'
    label: 'Style'
    type: 'string'
    default: 'btn-default'
    control: 'text-select'
    options: [
      value: 'btn-default'
      text: 'Default'
    ,
      value: 'btn-primary'
      text: 'Primary'
    ,
      value: 'btn-success'
      text: 'Success'
    ,
      value: 'btn-info'
      text: 'Info'
    ,
      value: 'btn-warning'
      text: 'Warning'
    ,
      value: 'btn-danger'
      text: 'Danger'
    ,
      value: 'btn-link'
      text: 'Link'
    ]
  ,
    name: 'size'
    label: 'Size'
    type: 'string'
    default: ''
    control: 'text-select'
    options: [
      value: 'btn-lg'
      text: 'Large'
    ,
      value: ''
      text: 'Medium'
    ,
      value: 'btn-sm'
      text: 'Small'
    ,
      value: 'btn-xs'
      text: 'Extra Small'
    ]
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'text-center'
    control: 'text-select'
    options: [
      value: 'text-left'
      text: 'Left'
    ,
      value: 'text-center'
      text: 'Center'
    ,
      value: 'text-right'
      text: 'Right'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass(inputs.align)
      target.attr('style', 'padding: 3px;')
      target.append("<a class='btn #{inputs.style} #{inputs.size}' href='#{inputs.href}' target='_blank' role='button' >#{inputs.text}</a>")
      true
    else
      false


class SeparatorFeature extends BaseFeature

  name: 'Separator'
  icon: 'glyphicon-minus'
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
    name: 'color'
    label: 'Color'
    type: 'string'
    control: 'color-picker'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
    default: '3'
    control: 'text-input'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
    default: '80'
    control: 'text-input'
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'center'
    control: 'text-select'
    options: [
      value: 'left'
      text: 'Left'
    ,
      value: 'center'
      text: 'Center'
    ,
      value: 'right'
      text: 'Right'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.append("<hr align='#{inputs.align}' width='#{inputs.width}%' style='background-color: #{inputs.color};height: #{inputs.height}px;' ></hr>")
      true
    else
      false


class TextWithParagraphFeature extends BaseFeature

  name: 'TextWithParagraph'
  icon: 'glyphicon-pencil'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'p'
      input: 'text'
    ,
      element: ':header'
      input: 'title'
    ]
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
    name: 'title'
    label: 'Title'
    type: 'string'
    default: 'Enter Your Title Here'
    control: 'text-input'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
    control: 'text-area'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass('well')
      template = "<h3 class='paragraph_title'>#{instance.inputs.title}</h3><p>#{instance.inputs.text}</p>"
      target.append(template)
      true
    else
      false

class ImageWithParagraphFeature extends BaseFeature

  name: 'ImageWithParagraph'
  icon: 'glyphicon-pencil'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'p'
      input: 'text'
    ,
      element: ':header'
      input: 'title'
    ]
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
    name: 'title'
    label: 'Title'
    type: 'string'
    default: 'Enter Your Title Here'
    control: 'text-input'
  ,
    name: 'src'
    label: 'Image URL'
    placeholder: 'http://a-z-animals.com/media/animals/images/original/capybara3.jpg'
    type: 'string'
    default: 'http://a-z-animals.com/media/animals/images/original/capybara3.jpg'
    control: 'text-input'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
    control: 'text-area'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass('well')
      template = """
          <h3>#{inputs.title}</h3>
          <div class='row-fluid'>
            <div id='#{id}_image' class='span2 pull-left' style='margin:0 3px'></div>
            <p class='span10'>#{inputs.text}</p>
          </div>
"""
      target.append(template)

      image = features.getFeature('ImageFeature')
      imageInputs = JSON.parse(JSON.stringify(inputs))
      imageInputs.page_location.target = '#' + "#{id}_image"
      imageInputs.width = '150'
      imageInputs.height = '150'
      image.generate(appMetadata, instance, imageInputs)

      true
    else
      false


class ContainerFeature extends BaseFeature

  name: 'Container'
  icon: 'glyphicon-th-large'
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
    name: 'columns'
    label: 'Columns'
    type: 'string'
    defaut: '2'
    control: 'text-input'
  ,
    name: 'rows'
    label: 'Rows'
    type: 'string'
    defaut: '1'
    control: 'text-input'
  ,
    name: 'well'
    label: 'Add Well'
    type: 'boolean'
    defaut: 'true'
    control: 'checkbox-input'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->

    target = $(inputs.page_location.target)
    if target.length > 0
      columns = parseInt(inputs.columns)
      columns = 12 if columns > 12
      col_size = 12/columns

      rows = parseInt(inputs.rows)

      containerId = @instanceId(instance, inputs)

      rowsClass = 'container-fluid'
      rowsClass += ' well' if inputs.well

      rowsParms = {class: "#{rowsClass}", id: containerId}
      if @designMode
        angular.extend(rowsParms, {'ui-draggable': 'true', 'drag': instance.id, 'drag-channel': 'B', 'drop-channel': 'A,B', 'ui-on-drop': "onDropFromContent($event,$index,$channel,$data,'#{instance.id}')"})

      $rows = $('<div/>', rowsParms)

      @addPageFeature(appMetadata, instance, inputs, containerId)

      row = 0
      while row < rows
        row += 1

        $row = $("<div/>", {class: 'row'})
        $rows.append($row)

        col = 0
        while col < columns
          col += 1
          id = "container_#{containerId}_row_#{row}_col_#{col}"
          rowParms = {class: "container-column col-md-#{col_size}", id: id}
          if @designMode
            angular.extend(rowParms, {'drop-channel': 'B', 'ui-on-drop': "onDropFromContentInContainer($event,$index,$data, '#{instance.id}', '#{id}')"})

          $row.append($("<div/>", rowParms))
          appMetadata.addPageTarget('Page 1', '#' + id, '#' + containerId, instance.id)

      target.append($rows)
      true
    else
      false


class HeaderFeature extends BaseFeature

  name: 'Header'
  icon: 'glyphicon-header'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: ':header'
      input: 'text'
    ]
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
    default: 'Enter your header text here'
    control: 'text-input'
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'text-center'
    control: 'text-select'
    options: [
      value: 'text-left'
      text: 'Left'
    ,
      value: 'text-center'
      text: 'Center'
    ,
      value: 'text-right'
      text: 'Right'
    ]
  ,
    name: 'size'
    label: 'Size'
    type: 'integer'
    default: '1'
    control: 'text-input'
    control_attributes:
      min: '1'
      max: '5'
      type: 'number'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.append("<H#{inputs.size} class='#{inputs.align}' >#{inputs.text}</H#{inputs.size}>")
      true
    else
      false


class ListFeature extends BaseFeature

  name: 'List'
  icon: 'glyphicon-list'
  visual_editor:
    control: 'list-editor'
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
    name: 'list'
    label: 'List Items'
    placeholder: 'Comma separated list'
    type: 'string'
    default: 'Red,Green,Blue'
    control: 'text-input'
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'center-block'
    control: 'text-select'
    options: [
      value: 'pull-left'
      text: 'Left'
    ,
      value: 'center-block'
      text: 'Center'
    ,
      value: 'pull-right'
      text: 'Right'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass(inputs.align)
      target.attr('style', 'width:200px;')
      lists = ''
      list = inputs.list.split(',')
      for item in list
        lists += "<li>#{item}</li>"
      target.append("<ul>#{lists}</ul>")
      true
    else
      false


class ListGroupFeature extends BaseFeature

  name: 'ListGroup'
  icon: 'glyphicon-list'
  visual_editor:
    control: 'list-editor'
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
    name: 'style'
    label: 'Style'
    type: 'string'
    default: 'panel-primary'
    control: 'text-select'
    options: [
      value: 'panel-primary'
      text: 'Primary'
    ,
      value: 'panel-success'
      text: 'Success'
    ,
      value: 'panel-info'
      text: 'Info'
    ,
      value: 'panel-warning'
      text: 'Warning'
    ,
      value: 'panel-danger'
      text: 'Danger'
    ]
  ,
    name: 'heading'
    label: 'Heading'
    type: 'string'
    default: 'List Group Heading'
    control: 'text-input'
  ,
    name: 'description'
    label: 'Description'
    type: 'string'
    default: 'This is our best offer ever.'
    control: 'text-area'
  ,
    name: 'list'
    label: 'List Items'
    placeholder: 'Comma separated list'
    type: 'string'
    default: 'Red,Green,Blue'
    control: 'text-input'
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'center-block'
    control: 'text-select'
    options: [
      value: 'pull-left'
      text: 'Left'
    ,
      value: 'center-block'
      text: 'Center'
    ,
      value: 'pull-right'
      text: 'Right'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass(inputs.align)
      target.addClass('text-center')
     # target.addClass('col-lg-4')

     # target.attr('style', 'width:200px;')

      lists = ''
      list = inputs.list.split(',')
      for item, index in list
        debugger
        if index < (list.length - 1)
          lists += "<li class='list-group-item' >#{item}</li>"
        else
          lists += """
            <li class="list-group-item">
              <h3><strong><span class="text-success">#{item}</span></strong></h3>
            </li>
"""

      pannel = """
        <div class="panel #{inputs.style}">
          <div class="panel-heading">
            <h4><strong>#{inputs.heading}</strong></h4>
          </div>
          <div class="panel-body">
            <strong><p>#{inputs.description}</p></strong>
            <br>
          </div>
          <ul class='list-group'>
            #{lists}
          </ul>
        </div>
"""

      target.append(pannel)
      true
    else
      false


class LinkFeature extends BaseFeature

  name: 'Link'
  icon: 'glyphicon-link'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'a'
      input: 'text'
    ]
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
    name: 'href'
    label: 'Link URL'
    placeholder: 'http://www.google.com'
    type: 'string'
    default: 'http://www.google.com'
    control: 'text-input'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Link to knowhere'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.append("<a href='#{inputs.href}' target='_blank'>#{inputs.text}</a>")
      true
    else
      false


class ImageFeature extends BaseFeature

  name: 'Image'
  icon: 'glyphicon-picture'
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
    name: 'src'
    label: 'Image URL'
    placeholder: 'http://a-z-animals.com/capybara3.jpg'
    type: 'string'
    default: 'http://assets.kompas.com/data/photo/2014/04/07/2002239katak-kulit-paling-kasar780x390.jpg'
    control: 'text-input'
  ,
    name: 'alt'
    label: 'Alt Text'
    type: 'string'
    default: 'some cool image'
    control: 'text-input'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
    default: '200'
    control: 'text-input'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
    default: '300'
    control: 'text-input'
  ,
    name: 'align'
    label: 'Align'
    type: 'string'
    default: 'center-block'
    control: 'text-select'
    options: [
      value: 'pull-left'
      text: 'Left'
    ,
      value: 'center-block'
      text: 'Center'
    ,
      value: 'pull-right'
      text: 'Right'
    ]
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      target.append("<img #{dd} id='#{id}' src='#{inputs.src}' alt='#{inputs.alt}' class='img-responsive  #{inputs.align}' height='#{inputs.height}' width='#{inputs.width}'>")
      true
    else
      false

class GoogleMapFeature extends BaseFeature

  name: 'GoogleMap'
  icon: 'glyphicon-map-marker'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'H4 a'
      input: 'address'
    ,
      element: 'H3'
      input: 'title'
    ]
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
    name: 'title'
    label: 'Title'
    type: 'string'
    control: 'text-input'
  ,
    name: 'address'
    label: 'Address'
    type: 'string'
    default: '131 Willow Rd. Guilford, CT'
    control: 'text-input'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
    default: '200'
    control: 'text-input'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
    default: '400'
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

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      target.addClass('well')
      template = "<h3>#{instance.inputs.title}</h3><h4><a href='http://maps.google.com/maps?q=#{instance.inputs.address}' >#{instance.inputs.address}</a><h4><div class='map_container'><img class='img-responsive' src='http://maps.googleapis.com/maps/api/staticmap?center=#{instance.inputs.address}&zoom=15&scale=2&size=#{instance.inputs.width}x#{instance.inputs.height}&markers=color:blue|#{instance.inputs.address}&sensor=true' /></div>"
      target.append(template)
      true
    else
      false

FeatureClasses = {
  PageFeature: PageFeature
  TextFeature: TextFeature
  LinkFeature: LinkFeature
  ImageFeature: ImageFeature
  ListFeature: ListFeature
  HeaderFeature: HeaderFeature
  ContainerFeature: ContainerFeature
  GoogleMapFeature: GoogleMapFeature
  TextWithParagraphFeature: TextWithParagraphFeature
  ImageWithParagraphFeature: ImageWithParagraphFeature
  DataResourceFeature: DataResourceFeature
  TableFeature: TableFeature
  ButtonFeature: ButtonFeature
  SeparatorFeature: SeparatorFeature
  ListGroupFeature: ListGroupFeature
}

features = new Features(true)

angular.module('sampleDomainApp').value 'Features', new Features(true)
