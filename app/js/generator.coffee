angular.module('sampleDomainApp').factory 'AppGenerate', ($compile, Features, AppMetadata) ->

  generate: (features, scope) ->
    $('#content_section').empty()
    AppMetadata.reset()
    for featureInstance in features
      f = Features.getFeature(featureInstance.feature)
      console.log 'generating for ' + JSON.stringify(featureInstance.inputs)
      f.generate(featureInstance, featureInstance.inputs, scope)


  compile: (scope) ->
    html = $('#content_section')
    $compile(html)(scope)
    true
