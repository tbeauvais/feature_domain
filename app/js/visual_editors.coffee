angular.module('sampleDomainApp').directive 'headerEditor', (AppMetadata) ->
  restrict: 'AEC'
  replace: false
  scope:
    featureInstance: '='

  link: (scope, elem, attrs) ->

    read = ->
      text = elem.find(':header').text()
      scope.featureInstance.inputs.text = text
      console.log 'Header text' + scope.featureInstance.inputs.text

    elem.find(':header').attr('contenteditable', '')
    elem.find(':header').bind 'click', (e) ->
      e.preventDefault()
      false

    elem.on 'blur keyup change', ->
      scope.$evalAsync(read)

    elem.on '$destroy', ->
      elem.find(':header').off 'click'
      elem.find(':header').removeAttr 'contenteditable'
      elem.off 'blur keyup change'
      console.log '$destroy Called !!!!!!!!!!!'



