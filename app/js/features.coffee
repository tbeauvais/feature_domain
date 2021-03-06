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
    featureInstance = { feature: name, id: '9'}
    inputs = {}
    for input in feature.inputs
      if input.name != 'page_location'
        inputs[input.name] = input.default || ''
    featureInstance.inputs = inputs
    featureInstance.cache = {}
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

    node = appMetadata.getPageTargetFeatureInstance(feature.page_info.page, feature.page_info.target)

    if node && feature.page_info.target != '#content_section' &&  feature.page_info.target != '#page_container'
      appMetadata.addFeatureDependency(node.model.feature_instance_id, instance.id)



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
  ,
    name: 'operation'
    label: 'Operation'
    type: 'string'
    default: 'GET'
    control: 'text-select'
    options: [
      value: 'GET'
      text: 'Get'
    ,
      value: 'POST'
      text: 'Post'
    ,
      value: 'PUT'
      text: 'Put'
    ,
      value: 'DELETE'
      text: 'Delete'
    ]
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    @addFeature(appMetadata, instance, inputs)
    appMetadata.addDataResource(inputs.name, inputs.resource, instance.id)

    url = new URL(inputs.resource)

    inputs.operation = 'GET' unless inputs.operation

    appMetadata.addDataResourceOperation(inputs.name, {feature_instance_id: instance.id, end_point: inputs.resource, id: instance.id, name: "#{inputs.operation} #{url.pathname}", operation: {}})

    # TODO Add to proper page location ()
    $('#content_section').append("<div class='service-resource' url='#{inputs.resource}' target='#{@cleanName(inputs.name)}' ></div>")


class SwaggerDataResourceFeature extends BaseFeature

  name: 'SwaggerDataResource'
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
    default: 'http://sales-api.mybluemix.net/swagger_doc/sales.json'
    type: 'string'
    control: 'text-input'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    @addFeature(appMetadata, instance, inputs)
    appMetadata.addDataResource(inputs.name, inputs.resource, instance.id)

    if instance.cache.swagger
      swagger = instance.cache.swagger
      for key, value of swagger.models
        appMetadata.addDataSchema(key, value, instance.id)
      for api in swagger.apis
        path = api.path
        for operation in api.operations
          appMetadata.addDataResourceOperation(inputs.name, {feature_instance_id: instance.id, end_point: "#{swagger.basePath}#{path}", id: "#{operation.method} #{path}", name: "#{operation.method} #{path}", operation: operation})
    else
      $.get inputs.resource, (data) ->
        instance.cache.swagger = data


class ScriptTestFeature extends BaseFeature

  name: 'ScriptTest'
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

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    @addFeature(appMetadata, instance, inputs)
    script = """
        $.get('#{inputs.resource}', function (data) {
          alert('hi ' + data.query.results.channel.item.condition.temp);
        });
"""
    eval(script)


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
    name: 'data_resource'
    label: 'Data Resource'
    type: 'data_resource'
    default: ''
    control: 'resource-select'
    resource_types: [
      'GET',
      'DELETE'
    ]
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

    unless appMetadata.getDataResourceReferences(inputs.data_resource.name)
      return false

    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      labels = if inputs.labels then inputs.labels.split(',') else []
      filters = if inputs.filters then inputs.filters.split(',') else []
      fields = if inputs.fields then inputs.fields.split(',') else []

      operation = appMetadata.getDataResourceOperation(inputs.data_resource.name, inputs.data_resource.operation)

      if inputs.data_resource.delete_operation
        delete_operation = appMetadata.getDataResourceOperation(inputs.data_resource.name, inputs.data_resource.delete_operation)

        # add parameter information to url
        deleteUrl = "'#{delete_operation.end_point}'"
        for parameter in delete_operation.operation.parameters
          deleteUrl = deleteUrl.replace("{#{parameter.name}}", "' + data.#{parameter.name} + '");

      resourceName = @cleanName(inputs.data_resource.name)

      repeatingDataName = ''
      repeatingDataProperty = null
      # Find the repeating data to use for the table
      if operation && operation.operation && operation.operation.type
        schema = appMetadata.getDataSchema(operation.operation.type)
        if schema
          for key, property of schema.schema.properties
            if property.type == 'array'
              repeatingDataName = ".#{key}"
              repeatingDataProperty = property

      references = appMetadata.getDataResourceReferences(inputs.data_resource.name)
      # TODO exclude operation from references (need to know what's a reference)
      if references.length <= 1
        target.append("<div class='service-resource' url='#{operation.end_point}' target='#{resourceName}' ></div>")

      appMetadata.addDataResourceReference(inputs.data_resource.name, instance.id)

      # get the properties of the repeating data
      if repeatingDataProperty && repeatingDataProperty.items.$ref
        data = appMetadata.getDataSchema(repeatingDataProperty.items.$ref)
        if data && data.schema
          fields = _.map data.schema.properties, (property, name) ->
            name
          labels = _.map data.schema.properties, (property, name) ->
            property.description

      headerRow = ''
      dataRow = ''

      for field, index in fields
        filter = ''
        filter = ' | ' + filters[index] if filters[index] && filters[index].length > 0
        dataRow += "<td ng-bind-html='data.#{field}#{filter}' ></td>"

        headerRow += "<th>#{labels[index] || field}</th>"

      if delete_operation
        headerRow += "<th>Delete</th>"
        dataRow += """
         <td><button ng-click="$emit('deleteResource', #{deleteUrl})" type="button" class="btn btn-danger btn-xs">Delete</button></td>
        """

      target.append("<div #{dd} id='#{id}' class='table-responsive' style='background-color: #ffffff'><table class='table table-hover table-striped' ><tr>#{headerRow}</tr> <tr ng-repeat='data in DataResource.#{resourceName}#{repeatingDataName}'>#{dataRow}</tr></table></div>")
      true
    else
      false


class FormFeature extends BaseFeature

  name: 'Form'
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
    name: 'data_resource'
    label: 'Data Resource'
    type: 'data_resource'
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

    unless appMetadata.getDataResourceReferences(inputs.data_resource.name)
      return false

    id = @instanceId(instance, inputs)
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      labels = if inputs.labels then inputs.labels.split(',') else []
      filters = if inputs.filters then inputs.filters.split(',') else []
      fields = if inputs.fields then inputs.fields.split(',') else []

      post_operation = appMetadata.getDataResourceOperation(inputs.data_resource.name, inputs.data_resource.operation)

      resourceName = @cleanName(inputs.data_resource.name)

      references = appMetadata.getDataResourceReferences(inputs.data_resource.name)
      # TODO exclude operation from references (need to know what's a reference)
      if references.length <= 1
        target.append("<div class='service-resource' url='#{post_operation.end_point}' target='#{resourceName}' ></div>")

      appMetadata.addDataResourceReference(inputs.data_resource.name, instance.id)

      parameters = post_operation.operation.parameters
      dataRow = ''
      for parameter in parameters
        dataRow += """
          <div class="form-group">
            <label for="#{parameter.name}">#{parameter.name}</label>
            <input type="string" class="form-control" name="#{parameter.name}" ng-model="data.#{parameter.name}" id="#{parameter.name}" placeholder="#{parameter.description}">
          </div>
        """
      form = """
        <form class='well' name="form1">
          #{dataRow}
          <input ng-click="$emit('postResource', form1, data)" type="submit" value="Submit"/>
        <form>
      """
      target.append(form)

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
      type: 'text'
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
      type: 'text'
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
      type: 'text'
    ,
      element: ':header'
      input: 'title'
      type: 'text'
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
    name: 'style'
    label: 'Style'
    type: 'string'
    default: 'panel-info'
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

      template = """
        <div class="panel #{inputs.style}">
          <div class="panel-heading">
            <h4><strong>#{inputs.title}</strong></h4>
          </div>
          <div class="panel-body">
            <p>#{inputs.text}</p>
          </div>
        </div>
"""

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
      type: 'text'
    ,
      element: ':header'
      input: 'title'
      type: 'text'
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
    name: 'style'
    label: 'Style'
    type: 'string'
    default: 'panel-info'
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

      template = """
        <div class="panel #{inputs.style}">
          <div class="panel-heading">
            <h4><strong>#{inputs.title}</strong></h4>
          </div>
          <div class="panel-body">
            <div class='row-fluid'>
              <div id='#{id}_image' class='span2 pull-left' style='margin:0 3px'></div>
              <p class='span10'>#{inputs.text}</p>
            </div>
          </div>
        </div>
"""

      target.append(template)

      image = features.getFeature('ImageFeature')
      imageInputs = JSON.parse(JSON.stringify(inputs))
      imageInputs.page_location.target = '#' + "#{id}_image"
      imageInputs.width = '150'
      imageInputs.height = '150'
      imageInputs.responsive = true
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


class PanelFeature extends BaseFeature

  name: 'Panel'
  icon: 'glyphicon-list'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'strong'
      input: 'heading'
      type: 'text'
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

      containerId = "#{id}_panel"

      dd = ''
      if @designMode
        dd = """
drop-channel='B' ui-on-drop="onDropFromContentInContainer($event,$index,$data,'#{instance.id}','#{containerId}')"
"""

      @addPageFeature(appMetadata, instance, inputs, id)

      appMetadata.addPageTarget(inputs.page_location.name, '#' + containerId, '#' + id, instance.id)

      template = """
        <div class="panel #{inputs.style}">
          <div class="panel-heading">
            <h4><strong>#{inputs.heading}</strong></h4>
          </div>
          <div class="panel-body" id="#{containerId}" #{dd}>
          </div>
        </div>
"""

      target.append(template)
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
      type: 'text'
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
    name: 'text_style'
    label: 'Text Style'
    type: 'string'
    default: 'text-info'
    control: 'text-select'
    options: [
      value: ''
      text: 'None'
    ,
      value: 'text-muted'
      text: 'Muted'
    ,
      value: 'text-primary'
      text: 'Primary'
    ,
      value: 'text-success'
      text: 'Success'
    ,
      value: 'text-info'
      text: 'Info'
    ,
      value: 'text-warning'
      text: 'Warning'
    ,
      value: 'text-danger'
      text: 'Danger'
    ]
  ,
    name: 'background'
    label: 'Background Style'
    type: 'string'
    default: ''
    control: 'text-select'
    options: [
      value: ''
      text: 'None'
    ,
      value: 'bg-primary'
      text: 'Primary'
    ,
      value: 'bg-success'
      text: 'Success'
    ,
      value: 'bg-info'
      text: 'Info'
    ,
      value: 'bg-warning'
      text: 'Warning'
    ,
      value: 'bg-danger'
      text: 'Danger'
    ]
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
      target.addClass(inputs.text_style)
      target.addClass(inputs.background)
      target.append("<H#{inputs.size} class='#{inputs.align}' >#{inputs.text}</H#{inputs.size}>")
      true
    else
      false


class ListFeature extends BaseFeature

  name: 'List'
  icon: 'glyphicon-list'
  visual_editor:
    control: 'visual-text-editor'
    targets: [
      element: 'ul'
      input: 'list'
      type: 'list'
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
    control: 'visual-text-editor'
    targets: [
      element: 'h4 strong'
      input: 'heading'
      type: 'text'
    ,
      element: '.panel-body strong p'
      input: 'description'
      type: 'text'
    ,
      element: 'ul'
      input: 'list'
      type: 'list'
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
        if index < (list.length - 1)
          lists += "<li class='list-group-item' >#{item}</li>"
        else
          lists += """
            <li class="list-group-item">
              <h3><strong><span class="text-success">#{item}</span></strong></h3>
            </li>
"""

      panel = """
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

      target.append(panel)
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
      type: 'text'
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
    name: 'responsive'
    label: 'Responsive'
    type: 'boolean'
    defaut: 'false'
    control: 'checkbox-input'
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

      responsive = ''
      responsive = 'img-responsive' if inputs.responsive

      target.append("<img #{dd} id='#{id}' src='#{inputs.src}' alt='#{inputs.alt}' class='#{responsive}  #{inputs.align}' height='#{inputs.height}' width='#{inputs.width}'>")
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
      type: 'text'
    ,
      element: 'H3'
      input: 'title'
      type: 'text'
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

class GoogleChartFeature extends BaseFeature

  name: 'GoogleChart'
  icon: 'glyphicon-signal'
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
    name: 'data_resource'
    label: 'Data Resource'
    type: 'data_resource'
    default: ''
    control: 'resource-select'
    resource_types: [
      'GET'
    ]
  ,
    name: 'type'
    label: 'Chart Type'
    type: 'string'
    default: 'p'
    control: 'text-select'
    options: [
      value: 'p'
      text: 'Pie'
    ,
      value: 'p3'
      text: 'Pie 3D'
    ,
      value: 'bvs'
      text: 'Bar Vertical'
    ,
      value: 'bhs'
      text: 'Bar Horizontal'
    ]
  ,
    name: 'color'
    label: 'Color'
    default: '#4D89F9'
    type: 'string'
    control: 'color-picker'
  ,
    name: 'field'
    label: 'Data Field'
    placeholder: ''
    type: 'string'
    default: ''
    control: 'text-input'
  ,
    name: 'label'
    label: 'Label Field'
    placeholder: ''
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
    name: 'alt'
    label: 'Alt Text'
    type: 'string'
    default: 'Cool chart'
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
    target = @getTarget(inputs.page_location, id, instance.id)
    if target.length > 0 && inputs.data_resource && inputs.data_resource.name
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      operation = appMetadata.getDataResourceOperation(inputs.data_resource.name, inputs.data_resource.operation)

      if inputs.data_resource.delete_operation
        delete_operation = appMetadata.getDataResourceOperation(inputs.data_resource.name, inputs.data_resource.delete_operation)

        # add parameter information to url
        deleteUrl = "'#{delete_operation.end_point}'"
        for parameter in delete_operation.operation.parameters
          deleteUrl = deleteUrl.replace("{#{parameter.name}}", "' + data.#{parameter.name} + '");

      resourceName = @cleanName(inputs.data_resource.name)

      repeatingDataName = ''
      repeatingDataProperty = null
      # Find the repeating data to use for the table
      if operation && operation.operation && operation.operation.type
        schema = appMetadata.getDataSchema(operation.operation.type)
        if schema
          for key, property of schema.schema.properties
            if property.type == 'array'
              repeatingDataName = ".#{key}"
              repeatingDataProperty = property

      references = appMetadata.getDataResourceReferences(inputs.data_resource.name)

      appMetadata.addDataResourceReference(inputs.data_resource.name, instance.id)

      target.append("<div class='google-chart' field='#{inputs.field}' type='#{inputs.type}' label='#{inputs.label}' color='#{inputs.color.slice(1)}' width='#{inputs.width}' height='#{inputs.height}' align='#{inputs.align}' target='DataResource.#{resourceName}#{repeatingDataName}'></div>")
      true
    else
      false

class WatsonTextToSpeechFeature extends BaseFeature

  name: 'WatsonTextToSpeech'
  icon: 'glyphicon-volume-up'
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
    placeholder: 'Enter your text'
    type: 'string'
    default: ''
    control: 'text-area'
  ,
    name: 'voice'
    label: 'Voice'
    type: 'string'
    default: 'VoiceEnUsMichael'
    control: 'text-select'
    options: [
      value: 'VoiceEnUsMichael'
      text: 'Male English'
    ,
      value: 'VoiceEnUsLisa'
      text: 'Female English'
    ,
      value: 'VoiceEsEsEnrique'
      text: 'Male Spanish'
    ]
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
      audio = """
        <div >
          <audio class="#{inputs.align}" controls>
            <source src="https://stream.watsonplatform.net/text-to-speech-beta/api/v1/synthesize?text=#{inputs.text}&voice=#{inputs.voice}" type="audio/ogg">
            Your browser does not support the audio element.
          </audio>
        </div>
"""
      target.append(audio)
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
  SwaggerDataResourceFeature: SwaggerDataResourceFeature
  TableFeature: TableFeature
  ButtonFeature: ButtonFeature
  SeparatorFeature: SeparatorFeature
  ListGroupFeature: ListGroupFeature
  PanelFeature: PanelFeature
  ScriptTestFeature: ScriptTestFeature
  FormFeature: FormFeature
  GoogleChartFeature: GoogleChartFeature
  WatsonTextToSpeechFeature: WatsonTextToSpeechFeature
}

features = new Features(true)

angular.module('sampleDomainApp').value 'Features', new Features(true)
