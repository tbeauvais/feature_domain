
angular.module('sampleDomainApp').factory 'FeatureNames',  ->

  ['TextFeature', 'LinkFeature', 'ImageFeature', 'ListFeature', 'HeaderFeature', 'ContainerFeature', 'GoogleMapFeature', 'TextWithParagraphFeature', 'ImageWithParagraphFeature', 'PageFeature']

angular.module('sampleDomainApp').factory 'Features', ($injector, FeatureNames) ->

  featureList = {}

  for name in FeatureNames
    # Lookup from factory using feature name
    feature = $injector.get(name)
    featureList[name] = new feature

  getFeature: (name) ->
    featureList[name]

  getFeatures:  ->
    featureList

  createFeatureInstance: (name) ->
    # TODO need a better way to do this, also add default values
    feature = featureList[name]
    featureInstance = { feature: name, id: '9', template: ''}
    inputs = {}
    for input in feature.inputs
      if input.name != 'page_location'
        inputs[input.name] = ''
      else
        inputs[input.name] = {name: 'Page 1', target: '#page_container'} # need to look this target up
    inputs.name = 'untitled'
    featureInstance['inputs'] = inputs
    featureInstance

angular.module('sampleDomainApp').factory 'BaseFeature', (AppMetadata) ->

  class BaseObject
    constructor: (initData) ->
      angular.extend(@, initData )

    dragDropSupport: (id) ->
      "ui-draggable='true' drag='#{id}' drag-channel='B' drop-channel='B,A' ui-on-drop='onDropFromContent($event,$index,$channel,$data,#{id})'"

    addFeature: (instance, inputs, id) ->
      AppMetadata.addFeature({id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: id, page: inputs.page_location.name, target: inputs.page_location.target}})

    instanceId: (instance, inputs) ->
      (inputs.name + '_' + instance.id).replace(/\s+/g, '_').toLowerCase();


angular.module('sampleDomainApp').factory 'PageFeature', (AppMetadata, BaseFeature) ->

  class PageFeature extends BaseFeature

    name: 'Page'
    icon: 'glyphicon-file'
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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        AppMetadata.addPageTarget('Page 1', '#page_container', '#' + id, instance.id)
        target.append("<div id='page_container' title='generated from #{instance.name}' ></div>")
        true
      else
        false


angular.module('sampleDomainApp').factory 'TextFeature', (AppMetadata, BaseFeature) ->

  class TextFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        target.append("<div #{dd} id='#{id}' title='generated from #{instance.name}' >#{inputs.text}</div>")
        true
      else
        false


angular.module('sampleDomainApp').factory 'TextWithParagraphFeature', (AppMetadata, BaseFeature) ->

  class TextWithParagraphFeature extends BaseFeature

    name: 'TextWithParagraph'
    icon: 'glyphicon-pencil'
    inputs: [
      name: 'name'
      label: 'Name'
      type: 'string'
    ,
      name: 'title'
      label: 'Title'
      type: 'string'
    ,
      name: 'text'
      label: 'Text'
      type: 'textarea'
    ,
      name: 'page_location'
      label: 'Page Location'
      type: 'page_location'
    ]

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        template = "<div #{dd} class='well' id='#{id}'><h3 class='paragraph_title'>#{instance.inputs.title}</h3><p>#{instance.inputs.text}</p></div>"
        target.append(template)
        true
      else
        false

angular.module('sampleDomainApp').factory 'ImageWithParagraphFeature', (AppMetadata, BaseFeature, HeaderFeature) ->

  class ImageWithParagraphFeature extends BaseFeature

    name: 'ImageWithParagraph'
    icon: 'glyphicon-pencil'
    inputs: [
      name: 'name'
      label: 'Name'
      type: 'string'
    ,
      name: 'title'
      label: 'Title'
      type: 'string'
    ,
      name: 'src'
      label: 'Image URL'
      placeholder: 'http://a-z-animals.com/capybara3.jpg'
      type: 'string'
    ,
      name: 'text'
      label: 'Text'
      type: 'textarea'
    ,
      name: 'page_location'
      label: 'Page Location'
      type: 'page_location'
    ]

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        template = "<div #{dd} class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><div class='row-fluid'><img class='span2 img-responsive pull-left' style='margin:0 3px' src='#{inputs.src}' height='150' width='150' /><p class='span10'>#{instance.inputs.text}</p></div></div>"
        target.append(template)
        true
      else
        false


angular.module('sampleDomainApp').factory 'ContainerFeature', (AppMetadata, BaseFeature) ->

  class ContainerFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->

      target = $(inputs.page_location.target)
      if target.length > 0
        columns = parseInt(inputs.columns)
        columns = 12 if columns > 12
        col_size = 12/columns

        rows = parseInt(inputs.rows)

        containerId = @instanceId(instance, inputs)
        $rows = $('<div/>', {class: 'container-fluid well', id: containerId, 'ui-draggable': 'true', 'drag': instance.id, 'drag-channel': 'B', 'drop-channel': 'A', 'ui-on-drop': "onDropFromContent($event,$index,$channel,$data,'#{instance.id}')"})

        @addFeature(instance, inputs, containerId)

        row = 0
        while row < rows
          row += 1

          $row = $("<div/>", {class: 'row'})
          $rows.append($row)

          col = 0
          while col < columns
            col += 1
            id = "container_#{containerId}_row_#{row}_col_#{col}"
            $row.append($("<div/>", {class: "container-column col-md-#{col_size}", id: id, 'drop-channel': 'B', 'ui-on-drop': "onDropFromContentInContainer($event,$index,$data, '#{instance.id}', '#{id}')"}))
            AppMetadata.addPageTarget('Page 1', '#' + id, '#' + containerId, instance.id)

        target.append($rows)
        true
      else
        false


angular.module('sampleDomainApp').factory 'HeaderFeature', (AppMetadata, BaseFeature) ->

  class HeaderFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        target.append("<div #{dd} ><H#{inputs.size} id='#{id}' title='generated from #{instance.name}' >#{inputs.text}</H#{inputs.size}></div>")
        true
      else
        false


angular.module('sampleDomainApp').factory 'ListFeature', (AppMetadata, BaseFeature) ->

  class ListFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs, scope) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        listName = "list_#{instance.id}"
        scope[listName] = inputs.list.split(',')
        dd = @dragDropSupport(instance.id)
        target.append("<ul #{dd} id='#{id}' ><li ng-repeat='item in #{listName}'>{{item}}</li></ul>")
        true
      else
        false


angular.module('sampleDomainApp').factory 'LinkFeature', (AppMetadata, BaseFeature) ->

  class LinkFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        target.append("<div #{dd} id='#{id}' ><a href='#{inputs.href}' target='_blank'>#{inputs.text}</a></div>")
        true
      else
        false


angular.module('sampleDomainApp').factory 'ImageFeature', (AppMetadata, BaseFeature) ->

  class ImageFeature extends BaseFeature

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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        dd = @dragDropSupport(instance.id)
        target.append("<img #{dd} id='#{id}' src='#{inputs.src}' alt='#{inputs.alt}' class='img-responsive' height='#{inputs.height}' width='#{inputs.width}'>")
        true
      else
        false

angular.module('sampleDomainApp').factory 'GoogleMapFeature', (AppMetadata, BaseFeature) ->

  class GoogleMapFeature extends BaseFeature

    name: 'GoogleMap'
    icon: 'glyphicon-map-marker'
    inputs: [
      name: 'name'
      label: 'Name'
      type: 'string'
    ,
      name: 'title'
      label: 'Title'
      type: 'string'
    ,
      name: 'address'
      label: 'Address'
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

    constructor: (initData) ->
      super(initData)

    generate: (instance, inputs) ->
      id = @instanceId(instance, inputs)
      target = $(inputs.page_location.target)
      if target.length > 0
        @addFeature(instance, inputs, id)
        #template = "<div class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><h3 ><a target='_blank' href='http://maps.google.com/maps?q=#{instance.inputs.address}' >#{instance.inputs.address}</a></h3><div class='map_container'><iframe width='100%' height='300' frameborder='0' scrolling='no' marginheight='0' marginwidth='0' src='http://maps.google.com/maps?q=#{instance.inputs.address}&output=embed'></iframe></div></div>"
        dd = @dragDropSupport(instance.id)
        template = "<div #{dd} class='well' id='#{id}'><h3>#{instance.inputs.title}</h3><h3 ><a href='http://maps.google.com/maps?q=#{instance.inputs.address}' >#{instance.inputs.address}</a></h3><div class='map_container'><img src='http://maps.googleapis.com/maps/api/staticmap?center=#{instance.inputs.address}&zoom=15&size=500x300&markers=color:blue|#{instance.inputs.address}&sensor=true' /></div></div>"
        $(inputs.page_location.target).append(template)
        true
      else
        false
