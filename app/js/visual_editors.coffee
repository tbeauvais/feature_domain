angular.module('sampleDomainApp').directive 'headerEditor', (AppMetadata) ->
  restrict: 'AEC'
  replace: false
  scope:
    model: '='

  link: (scope, elem, attrs) ->

    read = ->
      text = elem.find(':header').text()
      scope.model.text = text

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



