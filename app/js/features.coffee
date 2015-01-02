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

  addFeature: (appMetadata, instance, inputs, id) ->
    appMetadata.addFeature({id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: id, page: inputs.page_location.name, target: inputs.page_location.target}})

  instanceId: (instance, inputs) ->
    (inputs.name + '_' + instance.id).replace(/\s+/g, '_').toLowerCase();


class PageFeature extends BaseFeature

  name: 'Page'
  icon: 'glyphicon-file'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      appMetadata.addPageTarget('Page 1', '#page_container', '#' + id, instance.id)
      target.append("<div id='page_container' title='generated from #{instance.name}' ></div>")
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
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      target.append("<div #{dd} id='#{id}' title='generated from #{instance.name}' >#{inputs.text}</div>")
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
  ,
    name: 'title'
    label: 'Title'
    type: 'string'
    default: 'Enter Your Title Here'
  ,
    name: 'text'
    label: 'Text'
    type: 'textarea'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
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
  ,
    name: 'title'
    label: 'Title'
    type: 'string'
    default: 'Enter Your Title Here'
  ,
    name: 'src'
    label: 'Image URL'
    placeholder: 'http://a-z-animals.com/media/animals/images/original/capybara3.jpg'
    type: 'string'
    default: 'http://a-z-animals.com/media/animals/images/original/capybara3.jpg'
  ,
    name: 'text'
    label: 'Text'
    type: 'textarea'
    default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      template = "<div #{dd} class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><div class='row-fluid'><img class='span2 img-responsive pull-left' style='margin:0 3px' src='#{inputs.src}' height='150' width='150' /><p class='span10'>#{instance.inputs.text}</p></div></div>"
      target.append(template)
      true
    else
      false



class ContainerFeature extends BaseFeature

  name: 'Container'
  icon: 'glyphicon-th'
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
    default: 'untitled'
  ,
    name: 'columns'
    label: 'Columns'
    type: 'string'
    defaut: '2'
  ,
    name: 'rows'
    label: 'Rows'
    type: 'string'
    defaut: '1'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
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

      rowsParms = {class: 'container-fluid well', id: containerId}
      if @designMode
        angular.extend(rowsParms, {'ui-draggable': 'true', 'drag': instance.id, 'drag-channel': 'B', 'drop-channel': 'A,B', 'ui-on-drop': "onDropFromContent($event,$index,$channel,$data,'#{instance.id}')"})

      $rows = $('<div/>', rowsParms)

      @addFeature(appMetadata, instance, inputs, containerId)

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
  inputs: [
    name: 'name'
    label: 'Name'
    type: 'string'
    default: 'untitled'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Enter your header text here'
  ,
    name: 'size'
    label: 'Size'
    type: 'string'
    defaut: '1'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      target.append("<div #{dd} ><H#{inputs.size} id='#{id}' title='generated from #{instance.name}' >#{inputs.text}</H#{inputs.size}></div>")
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
  ,
    name: 'list'
    label: 'List Items'
    placeholder: 'Comma separated list'
    type: 'string'
    default: 'Red,Green,Blue'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      lists = ''
      list = inputs.list.split(',')
      for item in list
        lists += "<li>#{item}</li>"
      target.append("<ul #{dd} id='#{id}' >#{lists}</ul>")
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
  ,
    name: 'href'
    label: 'Link URL'
    placeholder: 'http://www.google.com'
    type: 'string'
    default: 'http://www.google.com'
  ,
    name: 'text'
    label: 'Text'
    type: 'string'
    default: 'Link to knowhere'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
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
  ,
    name: 'src'
    label: 'Image URL'
    placeholder: 'http://a-z-animals.com/capybara3.jpg'
    type: 'string'
    default: 'http://assets.kompas.com/data/photo/2014/04/07/2002239katak-kulit-paling-kasar780x390.jpg'
  ,
    name: 'alt'
    label: 'Alt Text'
    type: 'string'
    default: 'some cool image'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
    default: '200'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
    default: '300'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      target.append("<img #{dd} id='#{id}' src='#{inputs.src}' alt='#{inputs.alt}' class='img-responsive' height='#{inputs.height}' width='#{inputs.width}'>")
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
  ,
    name: 'title'
    label: 'Title'
    type: 'string'
  ,
    name: 'address'
    label: 'Address'
    type: 'string'
    default: '131 Willow Rd. Guilford, CT'
  ,
    name: 'height'
    label: 'Height'
    type: 'string'
    default: '200'
  ,
    name: 'width'
    label: 'Width'
    type: 'string'
    default: '400'
  ,
    name: 'page_location'
    label: 'Page Location'
    type: 'page_location'
  ]

  constructor: (initData) ->
    super(initData)

  generate: (appMetadata, instance, inputs) ->
    id = @instanceId(instance, inputs)
    target = $(inputs.page_location.target)
    if target.length > 0
      @addFeature(appMetadata, instance, inputs, id)
      dd = @dragDropSupport(instance.id)
      template = "<div #{dd} class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><h3 ><a href='http://maps.google.com/maps?q=#{instance.inputs.address}' >#{instance.inputs.address}</a></h3><div class='map_container'><img class='img-responsive' src='http://maps.googleapis.com/maps/api/staticmap?center=#{instance.inputs.address}&zoom=15&scale=2&size=#{instance.inputs.width}x#{instance.inputs.height}&markers=color:blue|#{instance.inputs.address}&sensor=true' /></div></div>"
      $(inputs.page_location.target).append(template)
      true
    else
      false

FeatureClasses = {PageFeature: PageFeature, TextFeature: TextFeature, LinkFeature: LinkFeature, ImageFeature: ImageFeature, ListFeature: ListFeature, HeaderFeature: HeaderFeature, ContainerFeature: ContainerFeature, GoogleMapFeature: GoogleMapFeature, TextWithParagraphFeature: TextWithParagraphFeature, ImageWithParagraphFeature: ImageWithParagraphFeature}

angular.module('sampleDomainApp').value 'Features', new Features(true)
