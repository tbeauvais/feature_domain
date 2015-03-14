class @AppGenerate

  constructor: (appFeatures) ->

    @appFeatures = appFeatures

  generate: (features, Features, AppMetadata, scope) ->
    console.log("Running generate")
    promises = []
    AppMetadata.reset()
    tries = 0
    loop
      missingDependencies = []
      tries += 1
      for featureInstance in features

        # TODO move this to feature, to allow feature to add disabled metadata (references can look at this and no-op)
        unless featureInstance.inputs.disable == true

          f = Features.getFeature(featureInstance.feature)
          #console.log "generating pass #{tries} for " + JSON.stringify(featureInstance.inputs)

          result = f.generate(AppMetadata, featureInstance, featureInstance.inputs, scope)
          if typeof result.then == 'function'
            promises.push(result)
          else if !result
            missingDependencies.push(featureInstance)

      features = missingDependencies
      break if tries > 3 || missingDependencies.length == 0
    console.log("Generate complete")
    promises

  generateInstance: (featureInstance, inputs, Features, AppMetadata, scope) ->
    console.log("Running generateInstance")
    f = Features.getFeature(featureInstance.feature)
    f.generate(AppMetadata, featureInstance, inputs, scope)

    @generateDependencies(featureInstance, Features, AppMetadata, scope)
    console.log("GenerateInstance complete")

  generateDependencies: (featureInstance, Features, AppMetadata, scope) ->

    console.log("GenerateInstance dependencies #{featureInstance.inputs.name}")
    dependencies = AppMetadata.getFeatureDependencies(featureInstance.id)

    for dependency in dependencies
      featureInstance = @appFeatures.find(dependency.feature_instance_id)
      f = Features.getFeature(featureInstance.feature)
      f.generate(AppMetadata, featureInstance, featureInstance.inputs, scope)
      @generateDependencies(featureInstance, Features, AppMetadata, scope)

