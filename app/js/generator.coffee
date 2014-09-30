angular.module('sampleDomainApp').factory 'AppGenerate', ($compile, Features, AppMetadata) ->

  generate: (features, scope) ->
    # TODO add message (preGenerate) and do this else where
    $('#content_section').empty()
    AppMetadata.reset()
    tries = 0
    loop
      missingDependencies = []
      tries += 1
      for featureInstance in features
        f = Features.getFeature(featureInstance.feature)
        console.log "generating pass #{tries} for " + JSON.stringify(featureInstance.inputs)

        success = f.generate(featureInstance, featureInstance.inputs, scope)
        if !success
          missingDependencies.push(featureInstance)

      features = missingDependencies
      break if tries > 3 || missingDependencies.length == 0

    scope.$root.$broadcast('postGenerate')

  compile: (scope) ->
    html = $('#content_section')
    $compile(html)(scope)
    true
