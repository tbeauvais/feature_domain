angular.module('sampleDomainApp').controller 'FeaturesCtrl', ($scope, AppFeatures, AppGenerate) ->

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

  $scope.onDropComplete = (index, data, event) ->
    id = null
    t = document.elementFromPoint(event.tx, event.ty)
    target = $(t).closest('.item')
    if target.data()
      id = target.data().$scope.feature.id
      #name = target.data().$scope.feature.inputs.name
    console.log("dropped '#{data}' on, '#{name}'")
    $scope.$root.$broadcast('addFeature', data, id)

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
