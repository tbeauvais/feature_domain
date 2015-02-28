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
      # TODO fix this ID
      target.append("<div style='border: 5px solid dodgerblue;border-radius: 5px;padding: 8px;background-image: url(https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTdl-OtxypNdS1EePB5svEdeCIp0FwmOiza4bm_RJK6LTTKuigk)' id='page_container' title='generated from #{instance.name}' ></div>")
      true
    else
      false


class TextFeature extends BaseFeature

  name: 'Text'
  icon: 'glyphicon-pencil'
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
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      target.append("<span #{dd} id='#{id}' title='generated from #{instance.name}' >#{inputs.text}</span>")
      true
    else
      false


class TextWithParagraphFeature extends BaseFeature

  name: 'TextWithParagraph'
  icon: 'glyphicon-pencil'
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
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      template = "<div #{dd} class='well' id='#{id}'><h3 class='paragraph_title'>#{instance.inputs.title}</h3><p>#{instance.inputs.text}</p></div>"
      target.append(template)
      true
    else
      false


class ImageWithParagraphFeature extends BaseFeature

  name: 'ImageWithParagraph'
  icon: 'glyphicon-pencil'
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
    inputs.page_location.target = "#page_container"
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      template = """
          <div #{dd} class='well' id='#{id}'>
            <h3>#{inputs.title}</h3>
            <div class='row-fluid'>
              <div id='#{id}_image' class='span2 pull-left' style='margin:0 3px'></div>
              <p class='span10'>#{inputs.text}</p>
            </div>
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
    defaut: 'false'
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
  visual_editor: 'header-editor'
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
    default: 'center'
    control: 'text-select'
    options: 'left,center,right'
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
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)

      align = 'text-center'
      if inputs.align == 'left'
        align = 'text-left'
      else if inputs.align == 'right'
        align = 'text-right'

      unless target.attr('id') == id
        el = $("<div #{dd} id='#{id}' ></div>")
        target.append(el)
        target = el

      target.append("<H#{inputs.size} class='#{align}' title='generated from #{instance.name}' >#{inputs.text}</H#{inputs.size}>")
      true
    else
      false


class ListFeature extends BaseFeature

  name: 'List'
  icon: 'glyphicon-list'
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
    default: 'center'
    control: 'text-select'
    options: 'left,center,right'
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

      align = 'center-block'
      if inputs.align == 'left'
        align = 'pull-left'
      else if inputs.align == 'right'
        align = 'pull-right'

      lists = ''
      list = inputs.list.split(',')
      for item in list
        lists += "<li>#{item}</li>"
      target.append("<div #{dd} id='#{id}' class='#{align}' style='width:200px;' ><ul>#{lists}</ul></div>")
      true
    else
      false


class LinkFeature extends BaseFeature

  name: 'Link'
  icon: 'glyphicon-link'
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
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      target.append("<div #{dd} id='#{id}' ><a href='#{inputs.href}' target='_blank'>#{inputs.text}</a></div>")
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
    default: 'center'
    control: 'text-select'
    options: 'left,center,right'
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

      align = 'center-block'
      if inputs.align == 'left'
        align = 'pull-left'
      else if inputs.align == 'right'
        align = 'pull-right'

      target.append("<img #{dd} id='#{id}' src='#{inputs.src}' alt='#{inputs.alt}' class='img-responsive  #{align}' height='#{inputs.height}' width='#{inputs.width}'>")
      true
    else
      false

class GoogleMapFeature extends BaseFeature

  name: 'GoogleMap'
  icon: 'glyphicon-map-marker'
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
    target = $(inputs.page_location.target)
    if target.length > 0
      @addPageFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      template = "<div #{dd} class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><h3 ><a href='http://maps.google.com/maps?q=#{instance.inputs.address}' >#{instance.inputs.address}</a></h3><div class='map_container'><img class='img-responsive' src='http://maps.googleapis.com/maps/api/staticmap?center=#{instance.inputs.address}&zoom=15&scale=2&size=#{instance.inputs.width}x#{instance.inputs.height}&markers=color:blue|#{instance.inputs.address}&sensor=true' /></div></div>"
      $(inputs.page_location.target).append(template)
      true
    else
      false

FeatureClasses = {PageFeature: PageFeature, TextFeature: TextFeature, LinkFeature: LinkFeature, ImageFeature: ImageFeature, ListFeature: ListFeature, HeaderFeature: HeaderFeature, ContainerFeature: ContainerFeature, GoogleMapFeature: GoogleMapFeature, TextWithParagraphFeature: TextWithParagraphFeature, ImageWithParagraphFeature: ImageWithParagraphFeature, DataResourceFeature: DataResourceFeature, TableFeature: TableFeature}

features = new Features(true)

angular.module('sampleDomainApp').value 'Features', new Features(true)
