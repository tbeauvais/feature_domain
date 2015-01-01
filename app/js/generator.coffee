class @AppGenerate

#angular.module('sampleDomainApp').factory 'AppGenerate', ($compile, Features, AppMetadata) ->

  generate: (features, Features, AppMetadata) ->
    AppMetadata.reset()
    tries = 0
    loop
      missingDependencies = []
      tries += 1
      for featureInstance in features
        f = Features.getFeature(featureInstance.feature)
        #console.log "generating pass #{tries} for " + JSON.stringify(featureInstance.inputs)

        success = f.generate(AppMetadata, featureInstance, featureInstance.inputs)
        if !success
          missingDependencies.push(featureInstance)

      features = missingDependencies
      break if tries > 3 || missingDependencies.length == 0
