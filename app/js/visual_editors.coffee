angular.module('sampleDomainApp').directive 'visualTextEditor', (AppMetadata) ->
  restrict: 'AEC'
  replace: false
  scope:
    featureInstance: '='
    feature: '='

  link: (scope, elem, attrs) ->

    @targets = scope.feature.visual_editor.targets

    read = (scope, options) ->
      debugger
      text = elem.find(options.source).text()
      scope.featureInstance.inputs[options.target] = text


    for target in @targets
      elem.find(target.element).attr('contenteditable', '')
      elem.find(target.element).text(scope.featureInstance.inputs[target.input])
      elem.find(target.element).bind 'click', (e) ->
        e.preventDefault()
        false

      elem.on 'blur keyup change', target.element, {source: target.element, target: target.input}, (event)->
        debugger
        scope.$evalAsync(read, event.data)

    elem.on '$destroy', =>
      for target in @targets
        elem.find(target.element).off 'click'
        elem.find(target.element).removeAttr 'contenteditable'
        elem.find(target.element).off 'blur keyup change'

      console.log 'visualTextEditor destroyed'


angular.module('sampleDomainApp').directive 'listEditor', (AppMetadata) ->
  restrict: 'AEC'
  replace: false
  scope:
    featureInstance: '='

  link: (scope, elem, attrs) ->

    read = ->
      items = _.map elem.find('li'), (el)->
        $(el).text()
      text = items.join(',')
      scope.featureInstance.inputs.list = text

    elem.find('ul').attr('contenteditable', '')
    elem.find('ul').bind 'click', (e) ->
      e.preventDefault()
      false

    elem.on 'blur keyup change', ->
      scope.$evalAsync(read)

    elem.on '$destroy', ->
      elem.find('ul').off 'click'
      elem.find('ul').removeAttr 'contenteditable'
      elem.off 'blur keyup change'
      console.log 'listEditor destroyed'


