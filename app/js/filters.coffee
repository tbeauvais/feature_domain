
angular.module('sampleDomainApp').filter 'dataLink', ($sce)  ->
  (input, link) ->
    $sce.trustAsHtml("<a href='#{link}' target='_blank'>#{input}</a>")

