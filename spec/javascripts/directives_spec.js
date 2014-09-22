(function(){

  describe('directive: featureList', function () {
    var element, scope;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile) {
      scope = $rootScope.$new();

      element = '<div class="feature-list"></div>';

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds an unordered list element", function() {
      expect(element[0].tagName).toEqual('UL');
    });

    it("creates a repeat for features", function() {
      expect(element[0].innerHTML).toEqual('<!-- ngRepeat: feature in features -->');
    });

    it('adds features to model attribute', function() {
      expect(element[0].getAttribute('ng-model')).toEqual('features');
    });

    it('makes features sortable', function() {
      expect(element[0].getAttribute('ui-sortable')).toEqual('sortableOptions');
    });


  });

  describe('directive: featureItem', function () {
    var element, scope;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile) {
      scope = $rootScope.$new();

      element = '<feature-item>';

      scope.feature = {feature: 'TextFeature', inputs: {name: 'My Text'}};

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds proper content", function() {
      var content = '<div class="pull-left"><span class="glyphicon glyphicon-pencil"></span></div>' +
        '<span class="feature ng-binding">My Text</span>' +
        '<span class="pull-right feature-delete glyphicon glyphicon-remove-circle"></span>';
      expect(element[0].innerHTML).toEqual(content);
    });

  });


  describe('directive: featureEditor', function () {
    var element, scope;

    beforeEach(module('sampleDomainApp'));

    beforeEach(inject(function($rootScope, $compile) {
      scope = $rootScope.$new();

      element = '<div class="feature-editor"></div>';

      scope.feature = {feature: 'TextFeature', inputs: {name: 'My Text'}};

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds proper content", function() {
      var content = '<div class="feature-editor ng-scope">Select feature from list to edit its properties...<div></div></div>';
      expect(element[0].outerHTML).toEqual(content);
    });

    it("displays the proper editor", function() {
      scope.$root.$broadcast('featureSelected', scope.feature);
      var content = '<div class="feature-editor ng-scope"><h2>Text</h2><form id="edit_form" role="form" ng-submit="submit()" ng-controller="EditorCtrl" class="ng-scope ng-pristine ng-valid"><div class="form-group">  <label>Name</label>  <input name="name" placeholder="undefined" ng-model="inputs.name" class="form-control ng-pristine ng-untouched ng-valid"></div><div class="form-group">  <label>Text</label>  <input name="text" placeholder="undefined" ng-model="inputs.text" class="form-control ng-pristine ng-untouched ng-valid"></div><div class="form-group">  <label>Page Location</label>  <div class="page-target-selector control-group"><select ng-options="page for page in pages" ng-model="inputs.page_location.name" class="form-control page-select ng-pristine ng-untouched ng-valid"><option value="?" selected="selected"></option><option value="0">Page 1</option></select><select ng-options="target for target in targets" ng-model="inputs.page_location.target" class="form-control page-select ng-pristine ng-untouched ng-valid"><option value="?" selected="selected"></option><option value="0">#content_section</option></select></div></div><input type="submit" id="submit" value="Submit" class="btn btn-default"></form></div>';
      expect(element[0].outerHTML).toEqual(content);
    });


  });




})();
