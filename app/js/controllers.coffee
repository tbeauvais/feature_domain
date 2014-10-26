angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, AppFeatures, AppGenerate, AppMetadata) ->

  $scope.getFeatures = ->
    AppFeatures.loadFeatures().success (data) ->
      $scope.features = data
      $scope.generate()

  $scope.generate = ->
    AppGenerate.generate($scope.features, $scope)
    AppGenerate.compile($scope)

  $scope.sortableOptions =
    stop: (e, ui) ->
      $scope.generate()

  $scope.onDropComplete = (data, event) ->
    id = null
    t = document.elementFromPoint(event.tx, event.ty)
    target = $(t).closest('.item')
    if target.data()
      id = target.data().$scope.feature.id
      #name = target.data().$scope.feature.inputs.name
    #console.log("dropped '#{data}' on, '#{name}'")
    $scope.$root.$broadcast('addFeature', data, id)

  $scope.onDropFromContent = (data, event) ->
    # TODO this should be a string already (see features)
    data = data.toString()
    t = document.elementFromPoint(event.tx, event.ty)
    console.log(t)
    id = $(t).closest('[id]').attr('id')
    node = AppMetadata.getFeatures().first (node) ->
      if node.model.page_info
        node.model.page_info.id == id
      else
        false
    if node
      return if data == node.model.id
      console.log("onDropFromContent from '#{data}' to '#{node.model.id}'")
      $scope.$root.$broadcast('moveFeature', data, node.model.id)
    false

  $scope.getFeatures()


angular.module('sampleDomainApp').controller 'EditorCtrl', ($scope, AppFeatures, AppGenerate) ->

  $scope.submit =  ->
    features = AppFeatures.features()
    featureInstance = features.filter( (feature) ->
      $scope.featureId == feature.id
    )[0]

    highlighted = $('#content_section .highlight_feature')

    id = highlighted[0].id if highlighted.length > 0

    featureInstance.inputs = $scope.inputs
    # TODO need a way to map inputs
    featureInstance.inputs.page_location.target = $scope.selectedTarget.model.name
    AppGenerate.generate(features, $scope)
    AppGenerate.compile($scope)
    # TODO move highlight to feature generation (i.e. add class there)
    $("#content_section #" + "#{id}").addClass('highlight_feature') if id
    AppFeatures.saveFeatures()
    true
