angular.module('sampleDomainApp').directive 'visualTextEditor', (AppMetadata) ->
  restrict: 'AEC'
  replace: false
  scope:
    featureInstance: '='
    feature: '='

  link: (scope, elem, attrs) ->

    @targets = scope.feature.visual_editor.targets

    updateText = (scope, options) ->
      text = elem.find(options.source).text()
      scope.featureInstance.inputs[options.target] = text

    updateList = (scope, options)->
      items = _.map elem.find(options.source).find('li'), (el)->
        $(el).text()
      text = items.join(',')
      scope.featureInstance.inputs[options.target] = text

    for target in @targets
      elem.find(target.element).attr('contenteditable', '')

      if target.type == 'text'
        elem.find(target.element).text(scope.featureInstance.inputs[target.input])

      elem.find(target.element).bind 'click', (e) ->
        e.preventDefault()
        false

      if target.type == 'text'
        elem.on 'blur keyup change', target.element, {source: target.element, target: target.input}, (event)->
          scope.$evalAsync(updateText, event.data)
      else
        elem.on 'blur keyup change', target.element, {source: target.element, target: target.input}, (event)->
          scope.$evalAsync(updateList, event.data)

    elem.on '$destroy', =>
      for target in @targets
        elem.find(target.element).off 'click'
        elem.find(target.element).removeAttr 'contenteditable'
        elem.find(target.element).off 'blur keyup change'

      console.log 'visualTextEditor destroyed'
