angular.module('sampleDomainApp').directive 'pageTargetSelector', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  # target.model.name group by target.parent.model.name for target in targets
  template: """
     <div class='control-group'>
         <select ng-options='page for page in pages' ng-model='inputs.page_location.name' class='form-control page-select' />
         <select ng-options='target.model.name group by target.parent.model.name for target in targets' ng-model='selectedTarget' class='form-control page-select'/>
     </div>
"""
  # use parent scope
  scope: false

  link: (scope, elem, attrs) ->
    pages = AppMetadata.getPages()
    scope.pages = _.map pages, (page)->
      return page.name

    scope.targets = AppMetadata.getPageTargets('Page 1')
    target = _.find scope.targets, (target) ->
      scope.inputs.page_location.target == target.model.name

    scope.selectedTarget = target


angular.module('sampleDomainApp').directive 'textInput', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: """
    <div class='form-group' >
        <label>{{label}}</label>
        <input class='form-control' ng-model='model' />
    </div>
"""
  scope: {
    inputs: '='
    model: '='
    feature: '='
    name: '@'
  }

  link: (scope, elem, attrs) ->
    input = _.find scope.feature.inputs, (input) ->
      input.name == scope.name
    scope.label = input.label


angular.module('sampleDomainApp').directive 'textArea', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: """
    <div class='form-group' >
        <label>{{label}}</label>
        <textarea class='form-control' ng-model='model' />
    </div>
"""
  scope: {
    inputs: '='
    model: '='
    feature: '='
    name: '@'
  }

  link: (scope, elem, attrs) ->
    input = _.find scope.feature.inputs, (input) ->
      input.name == scope.name
    scope.label = input.label

angular.module('sampleDomainApp').directive 'checkboxInput', (AppMetadata) ->
  restrict: 'AEC',
  replace: true,
  template: """
     <div class="checkbox">
        <label>
          <input type='checkbox' ng-model='model' />{{label}}
        </label>
      </div>
"""
  # use parent scope
  #scope: false
  scope: {
    inputs: '='
    model: '='
    feature: '='
    name: '@'
  }

  link: (scope, elem, attrs) ->
    input = _.find scope.feature.inputs, (input) ->
      input.name == scope.name
    scope.label = input.label
