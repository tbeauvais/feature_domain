angular.module('sampleDomainApp').factory 'AppGenerate', ($compile, Features, AppMetadata) ->

  generate: (features, scope) ->
    $('#content_section').empty()
    AppMetadata.reset()
    for featureInstance in features
      f = Features.getFeature(featureInstance.feature)
      f.generate(featureInstance, featureInstance.inputs, scope)

    console.log AppMetadata.get_targets('Page 1')

  compile: (scope) ->
    html = $('#content_section')
    $compile(html)(scope)
    true
