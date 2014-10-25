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
      expect(element[0].innerHTML).toEqual('<!-- ngRepeat: feature in features track by feature.id -->');
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

    beforeEach(inject(function($rootScope, $compile, AppMetadata) {
      scope = $rootScope.$new();

      element = '<div class="feature-editor"></div>';

      instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      AppMetadata.addFeature({id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}})

      element = $compile(element)(scope);
      scope.$digest();
    }));

    it("adds proper content when no feature selected", function() {
      var content = '<div class="feature-editor ng-scope">Select feature from list to edit its properties...<div></div></div>';
      expect(element[0].outerHTML).toEqual(content);
    });

    describe('when feature selected', function () {

      it("form has 3 inputs", function () {
        scope.$root.$broadcast('featureSelected', '1');
        expect(element.find('input').length).toEqual(3);
      });

      it("adds select to pick page", function () {
        scope.$root.$broadcast('featureSelected',  '1');
        expect(element.find('select:first option').text()).toEqual('Page 1');
      });

      it("adds select to pick target", function () {
        scope.$root.$broadcast('featureSelected',  '1');
        expect(element.find('select:last option:last').text()).toEqual('#content_section');
      });

    });
  });

})();
