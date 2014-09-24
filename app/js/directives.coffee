angular.module('sampleDomainApp').directive 'featureList', (Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<ul class="list" ui-sortable="sortableOptions" ng-model="features"><li class="item" ng-repeat="feature in features"><feature-item></li></ul>',

  link: (scope, elem, attrs) ->
    scope.$on 'addFeature', (event, featureName) ->
      featureInstance = Features.createFeatureInstance(featureName+'Feature')
      AppFeatures.add(featureInstance)
      # using parent scope so apply and generate are on the parent
      scope.$apply()
      # function on controller
      scope.generate()
      scope.$broadcast('featureSelected', featureInstance);

angular.module('sampleDomainApp').directive 'featureItem', ($rootScope, Features, AppFeatures) ->
  restrict: 'AEC',
  replace: true,
  template: '<div><div class="pull-left"><span class="glyphicon {{glyphicon}}"></span></div><span class="feature">{{feature.inputs.name}}</span><span class="pull-right feature-delete glyphicon glyphicon-remove-circle"></span></div>',
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    # TODO fix the feature.feature naming
    scope.glyphicon = Features.getFeature(scope.feature.feature).icon
    elem.bind 'click', (e) ->
      scope.$root.$broadcast('featureSelected', scope.feature)
      e.preventDefault()
      false
    elem.find('.feature-delete').bind 'click', (e) ->
      # TODO Use angular bootstrap confirm dialog
      if confirm('Are you sure you want to delete this feature')
        AppFeatures.delete(scope.feature.id)
        # using parent scope so apply and generate are on the parent
        scope.$apply()
        # function on controller
        scope.generate()
        $rootScope.$broadcast('featureNotSelected');
      e.preventDefault()
      false

angular.module('sampleDomainApp').directive 'featureEditor', ($compile, $templateCache, Features, AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: '<div>Select feature from list to edit its properties...<div>',
  # use parent scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.$on 'featureSelected', (event, featureInstance) ->
      feature = Features.getFeature(featureInstance.feature)

      $('#content_section .highlight_feature').removeClass('highlight_feature')
      $("#content_section #" + featureInstance.id).addClass('highlight_feature')

      scope.inputs = {}
      scope.featureId = featureInstance.id
      inputs = []
      inputs.push("<h2>#{feature.name}</h2>")
      inputs.push("<form id='edit_form' role='form' ng-submit='submit()' ng-controller='EditorCtrl' >")
      for input in feature.inputs
        console.log input
        inputs.push("<div class='form-group' >")
        inputs.push("  <label>#{input.label}</label>")
        scope.inputs[input.name] = featureInstance.inputs[input.name]
        # TODO don't hard code this
        if input.name == 'page_location'
          inputs.push("  <input class='page-target-selector' />")
        else
          inputs.push("  <input name='#{input.name}' placeholder='#{input.placeholder}' ng-model='inputs.#{input.name}' class='form-control' />")

        inputs.push("</div>")

      inputs.push("<input type='submit' id='submit' value='Submit' class='btn btn-default' />")
      inputs.push("</form>")

      elem.html(inputs.join(''))
      html = $(elem.find('#edit_form'))
      $compile(html)(scope)
      # process model data {{foo}} (i.e. through watchers)
      scope.$apply()
      false
    scope.$on 'featureNotSelected', (event) ->
      elem.empty()
      $templateCache.get('')
      # TODO how do we share this with template:
      elem.html('<div>Select feature from list to edit its properties...<div>')
      scope.$apply()


angular.module('sampleDomainApp').directive 'pageTargetSelector', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: "<div class='control-group'><select ng-options='page for page in pages' ng-model='inputs.page_location.name' class='form-control page-select' /><select ng-options='target for target in targets' ng-model='inputs.page_location.target' class='form-control page-select'/></div>",
  # use parent scope
  scope: false

  link: (scope, elem, attrs) ->
    scope.pages = AppMetadata.get_pages()
    scope.targets = AppMetadata.get_targets('Page 1')


angular.module('sampleDomainApp').directive 'addFeature', (Features) ->
  restrict: 'AEC',
  replace: true,
  template: '<div class="btn-group">' +
      '<button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">Add Feature ' +
        '<span class="caret"></span>' +
      '</button>' +
      '<ul class="dropdown-menu" role="menu" ng-model="features">' +
        '<li ng-repeat="feature in features"><add-feature-item/></li>' +
      '</ul>' +
    '</div>',
  # use new scope
  scope: true,

  link: (scope, elem, attrs) ->
    scope.features = Features.getFeatures()


angular.module('sampleDomainApp').directive 'addFeatureItem',  ->
  restrict: 'AEC',
  replace: true,
  template: '<a href="#">{{feature.name}}</a>'
  # use parent scope
  scope: false,

  link: (scope, elem, attrs) ->
    elem.bind 'click', (e) ->
      scope.$root.$broadcast('addFeature', e.target.innerText)
      e.preventDefault()
      true
