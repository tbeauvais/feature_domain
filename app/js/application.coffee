angular.module('sampleDomainApp', ['ui.sortable','ang-drag-drop','ngResource','ngSanitize','colorpicker.module']).config ($locationProvider)->
  $locationProvider.html5Mode(true)
